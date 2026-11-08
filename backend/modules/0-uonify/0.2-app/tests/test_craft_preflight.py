"""Contrato de preparación Craft: autoridad, aislamiento y receta cerrada."""

from copy import deepcopy
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path

import pytest

from app.craft_capabilities import capability_for, pinned_capabilities
from app.craft_contracts import (input_manifest_payload, resolved_craft_job)
from app.craft_preflight import expected_composite_quote_binding, preflight_craft_job
from app.craft_contracts import canonical_sha256
from app.creative_asset_contract import bind_creative_asset, craft_asset_payload
from app.creative_provider_asset_adoption import (
    provider_video_adoption_request, provider_video_adoption_response)
from app.creative_provider_storage_import import ImportedVideo


ROOT = Path(__file__).parents[2]
FIXTURE = (ROOT / "artifacts/art02-validation-20261018/contract-proposal"
           / "synthetic-filmcraft-recovery.json")


def production_mapping():
    value = json.loads(FIXTURE.read_text())["resolvedJob"]
    snapshot = value["plan"]["snapshot"]
    request_snapshot = {
        "endpoint": "https://generativelanguage.googleapis.com/v1beta/models",
        "model": "synthetic-video-model", "body": {"prompt": "ART-02"},
        "inputManifest": [],
    }
    request_operations = [{
        "operationId": "00000000-0000-4000-8000-000000000040",
        "ordinal": 1, "unitId": "filmcraft_export", "kind": "video_export",
        "requestSha256": canonical_sha256(request_snapshot),
        "model": request_snapshot["model"], "endpoint": request_snapshot["endpoint"],
        "requestSnapshot": request_snapshot,
    }]
    snapshot.update(sourcePlanSha256="a" * 64, executionSnapshotSha256="b" * 64,
                    recipeSha256=canonical_sha256(snapshot["recipe"]),
                    requestGroupSha256=canonical_sha256(request_operations),
                    requestOperations=request_operations)
    value["plan"]["snapshotSha256"] = canonical_sha256(snapshot)
    value["authorization"] = {
        "mode": "approved", "receiptId": "00000000-0000-4000-8000-000000000030",
        "maxExternalSpendUsd": 0, "payer": "platform",
        "quoteBindingSha256": "0" * 64, "quoteSha256": "9" * 64,
        "costsSnapshotSha256": "8" * 64,
        "quoteMaxTotalUsd": "1.70",
        "quoteExpiresAt": (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat(),
    }
    value["authorization"]["quoteBindingSha256"] = expected_composite_quote_binding(
        resolved_craft_job(value))
    return value


def test_exact_capabilities_are_pinned_and_unknown_versions_fail_closed():
    capabilities = pinned_capabilities()
    assert {(x.engine, x.version) for x in capabilities} == {
        ("photocraft", "0.10.0"), ("effectcraft", "0.11.1"),
        ("filmcraft", "0.9.0"),
    }
    assert capability_for("filmcraft", "0.9.0", "video_export").commands[-1] == (
        "file.exportMedia"
    )
    with pytest.raises(ValueError, match="no autorizados"):
        capability_for("filmcraft", "0.9.1", "video_export")
    with pytest.raises(ValueError, match="no autorizados"):
        capability_for("filmcraft", "0.9.0", "shell")


def test_valid_server_resolved_job_is_ready_without_claiming_compute_is_free():
    result = preflight_craft_job(resolved_craft_job(production_mapping()))
    assert result.ready and result.blockers == ()
    assert result.external_generation_cost_usd == 0
    assert result.craft_compute_cost_state == "unknown_until_infrastructure_quote"
    assert len(result.resolved_inputs) == 5
    assert all(item["inputPath"].startswith("/work/inputs/")
               for item in result.resolved_inputs)


def test_provider_video_adoption_projects_into_a_ready_craft_job():
    value = production_mapping()
    original = value["inputs"][0]
    imported = ImportedVideo(
        "uonify-private-media", "creative/provider/attempt/output.mp4", 321,
        "video/mp4", 1_500_000, "a" * 64, 2.0, 1280, 720, 25)
    request = provider_video_adoption_request(
        imported, owner_user_id=original["ownerUserId"], asset_id=original["assetId"])
    expected = request.draft.expected
    receipt = provider_video_adoption_response(request, {
        "done": True, "totalBytesRewritten": str(expected.byte_size),
        "objectSize": str(expected.byte_size),
        "resource": {"bucket": expected.bucket, "name": expected.name,
                     "generation": "654", "size": str(expected.byte_size),
                     "contentType": expected.mime_type,
                     "metadata": {"sha256": expected.sha256}},
    })
    snapshot = bind_creative_asset(
        request.draft, receipt, owner_user_id=original["ownerUserId"],
        owner_project_id=original["ownerProjectId"],
        revision=original["assetRevision"],
        source_step_id="22222222-2222-4222-8222-222222222222",
        execution_graph_sha256="e" * 64)
    value["inputs"][0] = craft_asset_payload(
        snapshot, mount_name="provider-shot.mp4",
        persisted_snapshot_sha256=snapshot.snapshot_sha256,
        authorization_state="allowed")
    provisional = resolved_craft_job(value)
    value["inputManifestSha256"] = canonical_sha256(input_manifest_payload(provisional))
    value["authorization"]["quoteBindingSha256"] = expected_composite_quote_binding(
        resolved_craft_job(value))
    result = preflight_craft_job(resolved_craft_job(value))
    assert result.ready and result.blockers == ()
    assert result.resolved_inputs[0]["storageGeneration"] == 654
    assert result.resolved_inputs[0]["inputPath"].endswith("provider-shot.mp4")


@pytest.mark.parametrize(("mutate", "code"), [
    (lambda x: x["engine"].update(version="0.9.1"), "unsupported_capability"),
    (lambda x: x["authorization"].update(mode="art02_synthetic", receiptId=None),
     "missing_authorization"),
    (lambda x: x["authorization"].update(mode="forged"), "missing_authorization"),
    (lambda x: x["authorization"].update(payer="unknown"), "missing_authorization"),
    (lambda x: x["limits"].update(networkAccess=True), "isolation_required"),
    (lambda x: x["limits"].update(googleCredentials=True), "isolation_required"),
    (lambda x: x["authorization"].update(maxExternalSpendUsd=1),
     "external_spend_not_zero"),
    (lambda x: x["authorization"].update(quoteBindingSha256="0" * 64),
     "invalid_composite_quote"),
    (lambda x: x["authorization"].update(quoteMaxTotalUsd="0"),
     "invalid_composite_quote"),
    (lambda x: x["authorization"].update(costsSnapshotSha256="bad"),
     "invalid_composite_quote"),
    (lambda x: x["authorization"].update(quoteExpiresAt="2020-01-01T00:00:00+00:00"),
     "invalid_composite_quote"),
    (lambda x: x["plan"]["snapshot"]["requestOperations"][0]["requestSnapshot"]
     ["body"].update(prompt="tampered"), "invalid_composite_quote"),
    (lambda x: x["plan"]["snapshot"]["requestOperations"][0].pop("requestSnapshot"),
     "invalid_composite_quote"),
    (lambda x: x["plan"].update(snapshotSha256="f" * 64), "plan_snapshot_mismatch"),
    (lambda x: x.update(inputManifestSha256="f" * 64), "input_manifest_mismatch"),
    (lambda x: x["inputs"][0].update(ownerUserId="00000000-0000-4000-8000-999999999999"),
     "ownership_mismatch"),
    (lambda x: x["inputs"][0].update(ownerProjectId="00000000-0000-4000-8000-999999999999"),
     "ownership_mismatch"),
    (lambda x: x["inputs"][0].update(authorizationState="revoked"),
     "asset_not_authorized"),
    (lambda x: x["inputs"][0]["storageReceipt"].update(generation=0),
     "receipt_mismatch"),
    (lambda x: x["inputs"][0]["storageReceipt"].update(sha256="f" * 64),
     "receipt_mismatch"),
    (lambda x: x["inputs"][0].update(mountName="../escape.png"), "unsafe_mount"),
    (lambda x: x["inputs"][1].update(mountName=x["inputs"][0]["mountName"]),
     "duplicate_input"),
    (lambda x: x["plan"]["snapshot"]["recipe"]["shots"][0].update(
        assetId="00000000-0000-4000-8000-999999999999"), "missing_recipe_asset"),
    (lambda x: x["plan"]["snapshot"]["recipe"]["shots"][0].update(
        durationFrames=101), "timeline_out_of_bounds"),
    (lambda x: x["plan"]["snapshot"]["recipe"]["voice"].update(track="V3"),
     "wrong_track"),
    (lambda x: x["inputs"][0].update(kind="audio"), "wrong_asset_kind"),
    (lambda x: x["plan"]["snapshot"]["recipe"]["shots"][0].update(track="V99"),
     "wrong_track"),
    (lambda x: x["plan"]["snapshot"]["recipe"]["shots"][0]["framing"].update(
        scalePercent=200), "unsupported_shot_transform"),
])
def test_preflight_rejects_untrusted_or_incomplete_jobs(mutate, code):
    value = production_mapping()
    mutate(value)
    result = preflight_craft_job(resolved_craft_job(value))
    assert not result.ready
    assert code in {item.code for item in result.blockers}


def test_no_client_path_exists_in_the_strict_contract():
    value = production_mapping()
    value["inputs"][0]["clientPath"] = "/etc/passwd"
    with pytest.raises(ValueError, match="resolvedAsset debe contener exactamente"):
        resolved_craft_job(value)


def test_untranslated_audio_policy_is_blocked_instead_of_silently_ignored():
    value = production_mapping()
    value["plan"]["snapshot"]["recipe"]["music"]["ducking"] = {
        "reductionDb": -15, "fadeSeconds": 0.4,
    }
    result = preflight_craft_job(resolved_craft_job(value))
    assert not result.ready
    assert "unsupported_audio_policy" in {item.code for item in result.blockers}


@pytest.mark.parametrize(("mutate", "code"), [
    (lambda x: x["plan"]["snapshot"]["recipe"].update(canvas=[]), "invalid_canvas"),
    (lambda x: x["plan"]["snapshot"]["recipe"]["canvas"].update(frameRate=[]),
     "invalid_canvas"),
    (lambda x: x["inputs"][0].update(bytes="25724"), "receipt_mismatch"),
    (lambda x: x["inputs"][0]["storageReceipt"].update(name=7), "receipt_mismatch"),
    (lambda x: x["plan"]["snapshot"]["recipe"].update(shellCommand="rm"),
     "invalid_recipe_shape"),
])
def test_malformed_values_return_blockers_instead_of_crashing(mutate, code):
    value = production_mapping()
    mutate(value)
    result = preflight_craft_job(resolved_craft_job(value))
    assert not result.ready
    assert code in {item.code for item in result.blockers}

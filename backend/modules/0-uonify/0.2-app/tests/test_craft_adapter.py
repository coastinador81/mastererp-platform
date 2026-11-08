"""El adaptador produce un plan determinista y pone candidatos en cuarentena."""

from copy import deepcopy
from dataclasses import replace
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path

import pytest

from app.craft_adapter import accept_candidate_result, build_craft_adapter_plan
from app.craft_capabilities import CAPABILITY_MATRIX_SHA256
from app.craft_contracts import (CraftAttempt, canonical_sha256, input_manifest_payload,
                                 resolved_craft_job)
from app.craft_preflight import expected_composite_quote_binding, preflight_craft_job
from app.creative_edit_recipe import EDIT_RECIPE


ROOT = Path(__file__).parents[2]
FIXTURE = (ROOT / "artifacts/art02-validation-20261018/contract-proposal"
           / "synthetic-filmcraft-recovery.json")


def authorize(value):
    snapshot = value["plan"]["snapshot"]
    recipe = snapshot["recipe"]
    if "kind" not in recipe:
        snapshot.update(sourcePlanSha256="a" * 64,
                        executionSnapshotSha256="b" * 64)
    request_snapshot = {
        "endpoint": "https://generativelanguage.googleapis.com/v1beta/models",
        "model": "synthetic-creative-model",
        "body": {"operation": value["operation"]}, "inputManifest": [],
    }
    request_operations = [{
        "operationId": "00000000-0000-4000-8000-000000000040",
        "ordinal": 1, "unitId": f"{value['engine']['name']}_operation",
        "kind": value["operation"],
        "requestSha256": canonical_sha256(request_snapshot),
        "model": request_snapshot["model"], "endpoint": request_snapshot["endpoint"],
        "requestSnapshot": request_snapshot,
    }]
    snapshot.update(recipeSha256=canonical_sha256(recipe),
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


def fixture_parts():
    envelope = json.loads(FIXTURE.read_text())
    authorize(envelope["resolvedJob"])
    job = resolved_craft_job(envelope["resolvedJob"])
    attempt = CraftAttempt(job.job_id, envelope["attempts"][1]["attemptId"],
                           envelope["attempts"][1]["leaseToken"])
    envelope["candidateResult"]["nativeProject"]["relativePath"] = (
        "out/filmcraft/timeline.fcproj"
    )
    envelope["candidateResult"]["outputs"][0]["relativePath"] = (
        "out/filmcraft/final.mp4"
    )
    return job, attempt, envelope["candidateResult"]


def operation_job(engine, version, operation, recipe, *, all_inputs=False):
    value = json.loads(FIXTURE.read_text())["resolvedJob"]
    value["engine"] = {"name": engine, "version": version}
    value["operation"] = operation
    if not all_inputs:
        value["inputs"] = value["inputs"][:1]
    recipe = EDIT_RECIPE.validate_python(recipe).model_dump(mode="json")
    value["plan"]["snapshot"] = {
        "recipe": recipe, "recipeSha256": canonical_sha256(recipe),
        "readyForAdapter": True,
        "assets": [item["assetId"] for item in value["inputs"]],
    }
    value["plan"]["snapshotSha256"] = canonical_sha256(value["plan"]["snapshot"])
    provisional = resolved_craft_job(value)
    value["inputManifestSha256"] = canonical_sha256(input_manifest_payload(provisional))
    return resolved_craft_job(authorize(value))


def sources():
    return {"sourcePlanSha256": "a" * 64, "executionSnapshotSha256": "b" * 64,
            "strategySha256": "c" * 64, "directionSha256": "d" * 64,
            "skillVersion": "art02-proposal-1", "skillSourceSha256": "e" * 64}


def recipe_asset(source=None):
    source = source or json.loads(FIXTURE.read_text())["resolvedJob"]["inputs"][0]
    receipt = source["storageReceipt"]
    result = {"assetId": source["assetId"], "revision": source["assetRevision"],
            "kind": source["kind"], "widthPixels": source["media"]["widthPixels"],
            "heightPixels": source["media"]["heightPixels"],
            "receipt": {"bucket": receipt["bucket"], "name": receipt["name"],
                        "generation": receipt["generation"],
                        "mimeType": receipt["mimeType"], "byteSize": receipt["byteSize"],
                        "sha256": receipt["sha256"]}}
    if source["kind"] in ("video", "audio"):
        result["durationSeconds"] = source["media"]["durationSeconds"]
    if source["kind"] == "video":
        result["frameRate"] = source["media"]["frameRate"]
    if source["kind"] == "audio":
        result.update(sampleRateHz=source["media"]["sampleRateHz"],
                      channels=source["media"]["channels"],
                      encoding=source["media"]["encoding"])
    return result


def transform(x=0, y=0):
    return {"anchor": {"x": 0, "y": 0}, "position": {"x": x, "y": y},
            "scalePercent": {"x": 100, "y": 100}, "rotationDegrees": 0,
            "opacityPercent": 100}


def style():
    return {"fontFamily": "default", "fontFallback": "default", "weight": 400,
            "sizePixels": 64, "lineHeight": 1, "tracking": 0, "alignment": "left",
            "fill": "#FFFFFFFF", "stroke": None,
            "box": {"xPixels": 0, "yPixels": 0, "widthPixels": 1280,
                    "heightPixels": 720, "sourceWidthPixels": 1280,
                    "sourceHeightPixels": 720}}


def photo_recipe(*, with_text=False):
    layers = [{"kind": "source", "layerId": "photo",
               "sourceAssetId": recipe_asset()["assetId"], "zIndex": 0,
               "crop": {"xPixels": 0, "yPixels": 72, "widthPixels": 1280,
                        "heightPixels": 576, "sourceWidthPixels": 1280,
                        "sourceHeightPixels": 720},
               "transform": transform(), "blendMode": "normal"}]
    if with_text:
        text_style = style()
        text_style["box"].update(heightPixels=576, sourceHeightPixels=576)
        layers.append({"kind": "text", "layerId": "headline", "role": "headline",
                       "exactText": "ART-02", "destination": None, "zIndex": 1,
                       "style": text_style, "transform": transform()})
    return {"schemaVersion": 1, "kind": "image_edit",
            "adapterOperation": "image_edit", "sources": sources(),
            "target": {"mode": "create"}, "assets": [recipe_asset()],
            "canvas": {"widthPixels": 1280, "heightPixels": 576},
            "layers": layers, "outputMimeType": "image/png"}


def effect_recipe(*, interpolation="linear"):
    asset_id = recipe_asset()["assetId"]
    return {"schemaVersion": 1, "kind": "motion_graphics",
            "adapterOperation": "motion_graphics", "sources": sources(),
            "target": {"mode": "create"}, "assets": [recipe_asset()],
            "canvas": {"widthPixels": 1280, "heightPixels": 720,
                       "transparent": True,
                       "frameRate": {"numerator": 25, "denominator": 1},
                       "durationFrames": 25},
            "layers": [
                {"kind": "asset", "layerId": "image", "name": "Image", "zIndex": 0,
                 "inFrame": 0, "outFrame": 25, "sourceAssetId": asset_id,
                 "transform": transform()},
                {"kind": "text", "layerId": "title", "name": "SyntheticTitle",
                 "zIndex": 1, "inFrame": 0, "outFrame": 25,
                 "exactText": "ART-02", "style": style(),
                 "transform": transform(640, 360)},
            ],
            "keyframes": [
                {"layerId": "title", "property": "opacityPercent", "frame": 0,
                 "scalarValue": 0, "pointValue": None, "interpolation": interpolation},
                {"layerId": "title", "property": "opacityPercent", "frame": 20,
                 "scalarValue": 100, "pointValue": None, "interpolation": interpolation},
            ],
            "output": {"mimeType": "image/png",
                       "relativePattern": "out/effectcraft/render_%05d.png",
                       "frameCount": 25, "rgba": True}}


def canonical_video_job():
    inputs = json.loads(FIXTURE.read_text())["resolvedJob"]["inputs"]
    recipe = {"schemaVersion": 1, "kind": "video_assemble",
              "adapterOperation": "video_export", "sources": sources(),
              "target": {"mode": "create"},
              "assets": [recipe_asset(item) for item in inputs],
              "canvas": {"widthPixels": 1280, "heightPixels": 720,
                         "frameRate": {"numerator": 25, "denominator": 1},
                         "durationFrames": 100},
              "placements": [
                  {"assetId": inputs[0]["assetId"], "track": "V1",
                   "startFrame": 0, "durationFrames": 50},
                  {"assetId": inputs[1]["assetId"], "track": "V1",
                   "startFrame": 50, "durationFrames": 50},
                  {"assetId": inputs[2]["assetId"], "track": "V2",
                   "startFrame": 0, "durationFrames": 50},
                  {"assetId": inputs[3]["assetId"], "track": "A1",
                   "startFrame": 0, "durationFrames": 25, "gainDb": 0},
                  {"assetId": inputs[4]["assetId"], "track": "A2",
                   "startFrame": 0, "durationFrames": 25, "gainDb": -12,
                   "fadeStartFrame": 20, "fadeEndFrame": 25},
              ], "outputMimeType": "video/mp4"}
    return operation_job("filmcraft", "0.9.0", "video_export", recipe,
                         all_inputs=True)


def image_candidate(job, attempt, plan):
    recipe = job.plan.snapshot["recipe"]
    recipe_sha = canonical_sha256(recipe)
    sources_list = [{"assetId": item.asset_id, "revision": item.asset_revision}
                    for item in job.inputs]
    if job.engine.name == "photocraft":
        paths = [plan.output_relative_path]
    else:
        pattern = recipe["output"]["relativePattern"]
        paths = [pattern.replace("%05d", f"{index:05d}")
                 for index in range(recipe["output"]["frameCount"])]
    outputs = []
    for index, path in enumerate(paths):
        media = {"widthPixels": recipe["canvas"]["widthPixels"],
                 "heightPixels": recipe["canvas"]["heightPixels"],
                 "hasAlpha": True}
        if job.engine.name == "effectcraft":
            media["frameIndex"] = index
        outputs.append({
            "role": "image_master" if job.engine.name == "photocraft" else "rgba_frame",
            "relativePath": path, "mimeType": "image/png", "bytes": 100,
            "sha256": f"{index + 1:064x}", "media": media,
            "lineage": {"sources": sources_list, "recipeSha256": recipe_sha,
                        "jobBindingSha256": plan.job_binding_sha256},
            "storageDraft": {"state": "candidate_local", "relativePath": path,
                             "mimeType": "image/png"},
        })
    checks = ({"rpcOk": True, "nestedFailed": 0, "projectReopened": True,
               "widthPixels": recipe["canvas"]["widthPixels"],
               "heightPixels": recipe["canvas"]["heightPixels"],
               "layerCount": len(recipe["layers"]), "warnings": []}
              if job.engine.name == "photocraft" else
              {"rpcOk": True, "nestedFailed": 0, "projectReopened": True,
               "renderQueueState": "done", "renderedFrames": len(outputs),
               "expectedFrames": len(outputs), "missingFrames": [],
               "rgbaVerified": True, "firstFrame": paths[0],
               "lastFrame": paths[-1], "warnings": []})
    native_bytes = 500
    return {
        "schemaVersion": 1, "jobId": job.job_id, "attemptId": attempt.attempt_id,
        "leaseToken": attempt.lease_token,
        "jobBindingSha256": plan.job_binding_sha256,
        "inputManifestSha256": job.input_manifest_sha256,
        "recipeSha256": recipe_sha, "adapterPlanSha256": plan.plan_sha256,
        "capabilityMatrixSha256": CAPABILITY_MATRIX_SHA256,
        "engine": {"name": job.engine.name, "version": job.engine.version,
                   "operation": job.operation, "engineJobId": "synthetic-1"},
        "nativeProject": {"role": "native_project",
                          "relativePath": plan.native_project_relative_path,
                          "mimeType": ("application/zip" if job.engine.name == "photocraft"
                                       else "application/json"),
                          "bytes": native_bytes, "sha256": "a" * 64},
        "outputs": outputs, "outputManifestSha256": canonical_sha256(outputs),
        "preflight": checks,
        "metrics": {"wallMs": 10, "cpuMs": 5,
                    "mediaOutputBytes": 100 * len(outputs),
                    "totalArtifactBytes": native_bytes + 100 * len(outputs)},
        "publicationAuthorized": False,
    }


def test_adapter_is_deterministic_and_uses_only_sandbox_paths():
    job, _, _ = fixture_parts()
    preflight = preflight_craft_job(job)
    first = build_craft_adapter_plan(job, preflight)
    second = build_craft_adapter_plan(job, preflight)
    assert first == second and len(first.plan_sha256) == 64
    assert first.job_binding_sha256 == preflight.job_binding_sha256
    assert first.native_project_relative_path == "out/filmcraft/timeline.fcproj"
    assert first.output_relative_path == "out/filmcraft/final.mp4"
    assert all(item["path"].startswith("/work/inputs/") for item in first.inputs)
    assert [command.id for command in first.commands][:2] == [
        "file.newSequence", "media_import"
    ]
    assert [command.id for command in first.commands][-2:] == [
        "file.saveAs", "file.exportMedia"
    ]
    assert all(not command.id.startswith("shell") for command in first.commands)


def test_photocraft_adapter_translates_only_the_proven_crop_layer_and_exports():
    job = operation_job("photocraft", "0.10.0", "image_edit", photo_recipe())
    preflight = preflight_craft_job(job)
    plan = build_craft_adapter_plan(job, preflight)
    assert preflight.ready and plan.engine.name == "photocraft"
    assert [item.id for item in plan.commands] == [
        "doc_open", "image.crop", "doc_inspect", "doc_save", "doc_export",
    ]
    assert all("/work/" in str(item.params) or item.id in (
        "image.crop", "doc_inspect")
               for item in plan.commands)


def test_effectcraft_adapter_translates_typed_title_keyframes_and_rgba_render():
    job = operation_job("effectcraft", "0.11.1", "motion_graphics", effect_recipe())
    preflight = preflight_craft_job(job)
    plan = build_craft_adapter_plan(job, preflight)
    assert preflight.ready and plan.engine.name == "effectcraft"
    assert [item.id for item in plan.commands] == [
        "comp.new", "file.import", "layer.newText", "add_keyframe", "save_project",
        "renderQueue.add", "renderQueue.render",
    ]
    assert plan.commands[3].params["interpolation"] == "linear"


def test_filmcraft_adapter_consumes_canonical_video_recipe_and_audio_policy():
    job = canonical_video_job()
    preflight = preflight_craft_job(job)
    plan = build_craft_adapter_plan(job, preflight)
    ids = [item.id for item in plan.commands]
    assert preflight.ready and ids[:2] == ["file.newSequence", "media_import"]
    assert ids.count("timeline.place") == 5
    assert ids.count("clip.audioGain") == 2
    assert ids.count("mixer.setKeyframe") == 2
    assert ids[-2:] == ["file.saveAs", "file.exportMedia"]


def test_canonical_video_candidate_is_quarantined_valid_but_never_publishable():
    job = canonical_video_job()
    envelope = json.loads(FIXTURE.read_text())
    attempt = CraftAttempt(job.job_id, envelope["attempts"][1]["attemptId"],
                           envelope["attempts"][1]["leaseToken"])
    candidate = envelope["candidateResult"]
    candidate["nativeProject"]["relativePath"] = "out/filmcraft/timeline.fcproj"
    candidate["outputs"][0]["relativePath"] = "out/filmcraft/final.mp4"
    plan = build_craft_adapter_plan(job, preflight_craft_job(job))
    result = accept_candidate_result(job, attempt, plan, candidate)
    assert result.accepted and not result.publication_authorized


@pytest.mark.parametrize(("engine", "version", "operation", "recipe", "code"), [
    ("photocraft", "0.10.0", "image_edit", photo_recipe(with_text=True),
     "unsupported_photo_recipe"),
    ("effectcraft", "0.11.1", "motion_graphics", effect_recipe(interpolation="ease_out"),
     "unsupported_effect_recipe"),
])
def test_canonical_photo_and_effect_recipes_fail_closed_outside_proven_subset(
        engine, version, operation, recipe, code):
    result = preflight_craft_job(operation_job(engine, version, operation, recipe))
    assert not result.ready
    assert code in {item.code for item in result.blockers}


def test_adapter_refuses_a_failed_or_stale_preflight():
    job, _, _ = fixture_parts()
    broken = deepcopy(json.loads(FIXTURE.read_text())["resolvedJob"])
    authorize(broken)
    broken["authorization"]["receiptId"] = None
    broken_job = resolved_craft_job(broken)
    result = preflight_craft_job(broken_job)
    assert not result.ready
    with pytest.raises(ValueError, match="no autoriza"):
        build_craft_adapter_plan(job, result)


@pytest.mark.parametrize("change", [
    lambda job: replace(job, inputs=(replace(job.inputs[0], mount_name="changed.png"),
                                     *job.inputs[1:])),
    lambda job: replace(job, inputs=(replace(job.inputs[0], owner_user_id=
                                     "00000000-0000-4000-8000-999999999999"),
                                     *job.inputs[1:])),
    lambda job: replace(job, authorization=replace(job.authorization,
                                                   receipt_id=None)),
    lambda job: replace(job, limits=replace(job.limits, output_bytes=99)),
])
def test_preflight_cannot_be_reused_after_any_resolved_job_change(change):
    job, _, _ = fixture_parts()
    original_preflight = preflight_craft_job(job)
    with pytest.raises(ValueError, match="no autoriza"):
        build_craft_adapter_plan(change(job), original_preflight)


def test_valid_candidate_is_accepted_but_not_published_and_engine_job_is_diagnostic():
    job, attempt, candidate = fixture_parts()
    plan = build_craft_adapter_plan(job, preflight_craft_job(job))
    candidate["engine"]["engineJobId"] = 987654
    result = accept_candidate_result(job, attempt, plan, candidate)
    assert result.accepted and len(result.candidate_result_sha256) == 64
    assert not result.publication_authorized
    assert result.blockers == ()


@pytest.mark.parametrize(("mutate", "code"), [
    (lambda x: x.update(leaseToken="00000000-0000-4000-8000-999999999999"),
     "stale_attempt"),
    (lambda x: x.update(inputManifestSha256="f" * 64), "snapshot_mismatch"),
    (lambda x: x["engine"].update(version="0.9.1"), "engine_mismatch"),
    (lambda x: x["preflight"].update(nestedFailed=1), "invalid_media_result"),
    (lambda x: x["preflight"].update(offlineMedia=["missing.png"]),
     "invalid_media_result"),
    (lambda x: x["preflight"].update(projectReopened=False), "invalid_media_result"),
    (lambda x: x.update(outputs=[]), "missing_output"),
    (lambda x: x["outputs"].append(deepcopy(x["outputs"][0])), "missing_output"),
    (lambda x: x["outputs"][0].update(relativePath="../../escape.mp4"),
     "invalid_output"),
    (lambda x: x["outputs"][0].update(mimeType="text/plain"), "invalid_output"),
    (lambda x: x["nativeProject"].update(relativePath="out/other.fcproj"),
     "invalid_native_project"),
    (lambda x: x["outputs"][0].update(bytes=100000001), "output_limit_exceeded"),
    (lambda x: x["metrics"].update(mediaOutputBytes=1), "metrics_mismatch"),
    (lambda x: x["outputs"][0]["media"].update(widthPixels=640),
     "output_media_mismatch"),
    (lambda x: x.update(unexpected=True), "invalid_candidate_shape"),
    (lambda x: x.update(engine=[]), "invalid_candidate_shape"),
    (lambda x: x.update(preflight=[]), "invalid_candidate_shape"),
    (lambda x: x.update(nativeProject=[]), "invalid_candidate_shape"),
    (lambda x: x.update(outputs=["bad"]), "invalid_output"),
    (lambda x: x["outputs"][0].update(media=[]), "invalid_candidate_shape"),
    (lambda x: x["outputs"][0].update(bytes="212049"), "invalid_output"),
    (lambda x: x.update(metrics=[]), "invalid_candidate_shape"),
])
def test_candidate_failures_are_rejected_before_any_publication(mutate, code):
    job, attempt, candidate = fixture_parts()
    plan = build_craft_adapter_plan(job, preflight_craft_job(job))
    mutate(candidate)
    result = accept_candidate_result(job, attempt, plan, candidate)
    assert not result.accepted and not result.publication_authorized
    assert result.candidate_result_sha256 is None
    assert code in {item.code for item in result.blockers}


def test_non_mapping_candidate_fails_closed_without_publication():
    job, attempt, _ = fixture_parts()
    plan = build_craft_adapter_plan(job, preflight_craft_job(job))
    invalid = accept_candidate_result(job, attempt, plan, [])
    assert not invalid.accepted and not invalid.publication_authorized


@pytest.mark.parametrize(("engine", "version", "operation", "recipe"), [
    ("photocraft", "0.10.0", "image_edit", photo_recipe()),
    ("effectcraft", "0.11.1", "motion_graphics", effect_recipe()),
])
def test_canonical_image_candidates_are_valid_quarantined_and_lease_stable(
        engine, version, operation, recipe):
    job = operation_job(engine, version, operation, recipe)
    attempt = CraftAttempt(job.job_id, "00000000-0000-4000-8000-000000000041",
                           "00000000-0000-4000-8000-000000000042")
    plan = build_craft_adapter_plan(job, preflight_craft_job(job))
    candidate = image_candidate(job, attempt, plan)
    first = accept_candidate_result(job, attempt, plan, candidate)
    rotated = deepcopy(candidate)
    rotated.update(attemptId="00000000-0000-4000-8000-000000000043",
                   leaseToken="00000000-0000-4000-8000-000000000044")
    rotated["engine"]["engineJobId"] = "synthetic-retry-2"
    second_attempt = CraftAttempt(job.job_id, rotated["attemptId"], rotated["leaseToken"])
    second = accept_candidate_result(job, second_attempt, plan, rotated)
    assert first.accepted and second.accepted
    assert first.candidate_result_sha256 == second.candidate_result_sha256
    assert not first.publication_authorized and not candidate["publicationAuthorized"]


@pytest.mark.parametrize(("mutate", "code"), [
    (lambda x: x.update(adapterPlanSha256="f" * 64), "snapshot_mismatch"),
    (lambda x: x.update(outputManifestSha256="f" * 64), "output_manifest_mismatch"),
    (lambda x: x["outputs"][0]["lineage"].update(recipeSha256="f" * 64),
     "lineage_mismatch"),
    (lambda x: x["outputs"][0]["storageDraft"].update(state="uploaded"),
     "invalid_storage_draft"),
    (lambda x: x.update(publicationAuthorized=True), "publication_forbidden"),
    (lambda x: x["outputs"][0]["media"].update(hasAlpha=False), "invalid_output"),
    (lambda x: x["metrics"].update(wallMs=-1), "metrics_mismatch"),
    (lambda x: x["engine"].update(engineJobId={}), "invalid_candidate_shape"),
])
def test_effect_candidate_manifest_tampering_fails_closed(mutate, code):
    job = operation_job("effectcraft", "0.11.1", "motion_graphics", effect_recipe())
    attempt = CraftAttempt(job.job_id, "00000000-0000-4000-8000-000000000041",
                           "00000000-0000-4000-8000-000000000042")
    plan = build_craft_adapter_plan(job, preflight_craft_job(job))
    candidate = image_candidate(job, attempt, plan)
    mutate(candidate)
    result = accept_candidate_result(job, attempt, plan, candidate)
    assert not result.accepted and not result.publication_authorized
    assert code in {item.code for item in result.blockers}

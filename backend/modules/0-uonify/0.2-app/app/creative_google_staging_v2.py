"""Staging privado v2 de outputs Google y su manifiesto create-only."""

from base64 import b64encode
from dataclasses import asdict, dataclass, replace
from hashlib import md5, sha256
import json
from secrets import token_hex
from uuid import NAMESPACE_URL, uuid5

from .creative_cloud_tts_contracts import CloudTtsOutput
from .creative_composite_quote import canonical_json, canonical_sha256
from .creative_generated_storage import GeneratedStorageDraft, generated_storage_plan
from .creative_google_generation_authority import (
    GoogleGenerationAuthority, GoogleGenerationFence,
    google_generation_authority_snapshot, google_generation_fence_snapshot)
from .creative_google_preflight_receipt import GooglePreflightReceipt
from .creative_google_transport import GoogleDispatchResult
from .creative_image_contracts import ImageOutput
from .creative_music_contracts import MusicOutput
from .creative_storage_contracts import (
    ResumableStorageRequest, StorageObject, StorageReceipt, StorageRequest)
from .creative_video_contracts import VideoOutput
from .creative_voiceover_contracts import VoiceoverOutput


_MANIFEST_MIME = "application/vnd.uonify.google-staging-manifest+json"


@dataclass(frozen=True)
class GoogleStagingArtifact:
    output_ordinal: int
    artifact_ordinal: int
    draft: GeneratedStorageDraft


@dataclass(frozen=True)
class GoogleStagingPlanV2:
    authority: GoogleGenerationAuthority
    fence: GoogleGenerationFence
    artifacts: tuple[GoogleStagingArtifact, ...]


@dataclass(frozen=True)
class GoogleStagingManifestPlan:
    snapshot: dict
    sha256: str
    upload: StorageRequest


def _roles(output: object) -> tuple[str, ...]:
    if isinstance(output, ImageOutput):
        return ("generated_image",)
    if isinstance(output, VideoOutput):
        return ("generated_video",)
    if isinstance(output, MusicOutput):
        return ("generated_music",)
    if isinstance(output, CloudTtsOutput):
        return ("generated_voice_mp3",)
    if isinstance(output, VoiceoverOutput):
        return ("generated_voice_pcm", "derived_voice_wav")
    raise ValueError("Output Google no admitido para staging v2.")


def _stage_name(authority: dict, fence: dict, output_ordinal: int,
                artifact_ordinal: int, expected: StorageObject) -> str:
    extension = expected.name.rsplit(".", 1)[-1]
    return (f"creative/staging/google/{authority['ownerUserId']}/"
            f"{fence['attemptId']}/outputs/{output_ordinal:04d}/"
            f"{artifact_ordinal:04d}/{expected.sha256}.{extension}")


def _rename_upload(upload, name: str):
    expected = replace(upload.expected, name=name)
    metadata = {
        "name": name, "contentType": expected.mime_type,
        "md5Hash": expected.md5_base64, "cacheControl": "private, no-store",
        "metadata": {"sha256": expected.sha256},
    }
    encoded = json.dumps(metadata, separators=(",", ":")).encode()
    if isinstance(upload, ResumableStorageRequest):
        return replace(
            upload, metadata=encoded, expected=expected,
            headers={**upload.headers, "Content-Length": str(len(encoded))})
    if not isinstance(upload, StorageRequest) or upload.body is None:
        raise ValueError("Upload Google de staging no válido.")
    content_type = upload.headers.get("Content-Type", "")
    boundary = content_type.removeprefix("multipart/related; boundary=")
    marker = f"\r\n--{boundary}\r\nContent-Type: {expected.mime_type}\r\n\r\n".encode()
    if not boundary or marker not in upload.body:
        raise ValueError("Multipart Google de staging no válido.")
    media = upload.body.split(marker, 1)[1]
    prefix = (f"--{boundary}\r\nContent-Type: application/json; charset=UTF-8"
              "\r\n\r\n").encode()
    body = prefix + encoded + marker + media
    return replace(upload, body=body, expected=expected,
                   headers={**upload.headers, "Content-Length": str(len(body))})


def google_staging_plan_v2(
        result: GoogleDispatchResult, bucket: str,
        authority: GoogleGenerationAuthority,
        fence: GoogleGenerationFence) -> GoogleStagingPlanV2:
    authority_snapshot = google_generation_authority_snapshot(authority)
    fence_snapshot = google_generation_fence_snapshot(fence)
    if (not isinstance(result, GoogleDispatchResult)
            or result.state != "completed" or not result.outputs
            or result.attempt_id != fence.attempt_id
            or result.request_sha256 != authority.request_sha256):
        raise ValueError("Resultado y autoridad Google no coinciden.")
    ids, coordinates = [], []
    for output_ordinal, output in enumerate(result.outputs):
        for artifact_ordinal, role in enumerate(_roles(output)):
            ids.append(str(uuid5(
                NAMESPACE_URL,
                f"uonify:{fence.attempt_id}:{output_ordinal}:"
                f"{artifact_ordinal}:{role}")))
            coordinates.append((output_ordinal, artifact_ordinal, role))
    drafts = generated_storage_plan(
        result, bucket, authority.owner_user_id, tuple(ids))
    if len(drafts) != len(coordinates):
        raise ValueError("El staging Google perdió artefactos.")
    artifacts = []
    for draft, (output_ordinal, artifact_ordinal, role) in zip(
            drafts, coordinates):
        if draft.role != role:
            raise ValueError("El rol Google no coincide con su artefacto.")
        name = _stage_name(
            authority_snapshot, fence_snapshot, output_ordinal,
            artifact_ordinal, draft.upload.expected)
        artifacts.append(GoogleStagingArtifact(
            output_ordinal, artifact_ordinal,
            replace(draft, upload=_rename_upload(draft.upload, name))))
    return GoogleStagingPlanV2(authority, fence, tuple(artifacts))


def _manifest_upload(bucket: str, name: str, body: bytes) -> StorageRequest:
    digest = sha256(body).hexdigest()
    md5_base64 = b64encode(md5(body).digest()).decode("ascii")
    expected = StorageObject(
        bucket, name, _MANIFEST_MIME, len(body), digest, md5_base64)
    metadata = {
        "name": name, "contentType": _MANIFEST_MIME,
        "md5Hash": md5_base64, "cacheControl": "private, no-store",
        "metadata": {"sha256": digest, "uonifyStage": "google-v2-manifest"},
    }
    boundary = "uonify-" + token_hex(16)
    upload_body = (
        f"--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n"
        .encode() + json.dumps(metadata, separators=(",", ":")).encode()
        + f"\r\n--{boundary}\r\nContent-Type: {_MANIFEST_MIME}\r\n\r\n".encode()
        + body + f"\r\n--{boundary}--\r\n".encode())
    endpoint = (f"https://storage.googleapis.com/upload/storage/v1/b/{bucket}/o"
                "?uploadType=multipart&ifGenerationMatch=0")
    return StorageRequest(
        "POST", endpoint,
        {"Content-Type": f"multipart/related; boundary={boundary}",
         "Content-Length": str(len(upload_body))}, upload_body, expected)


def google_staging_manifest_v2(
        result: GoogleDispatchResult, plan: GoogleStagingPlanV2,
        receipts: tuple[StorageReceipt, ...],
        preflight: GooglePreflightReceipt) -> GoogleStagingManifestPlan:
    authority = google_generation_authority_snapshot(plan.authority)
    fence = google_generation_fence_snapshot(plan.fence)
    if (not isinstance(result, GoogleDispatchResult)
            or result.state != "completed" or not result.outputs
            or result.attempt_id != plan.fence.attempt_id
            or result.request_sha256 != plan.authority.request_sha256
            or not isinstance(receipts, tuple)
            or len(receipts) != len(plan.artifacts)
            or not isinstance(preflight, GooglePreflightReceipt)
            or canonical_sha256(preflight.snapshot) != preflight.sha256):
        raise ValueError("Manifiesto Google no coincide con su staging.")
    dispatch_keys = {
        "attemptId", "requestSha256", "provider", "state",
        "providerOperation", "outputSha256", "usage"}
    expected_provider = ("google_cloud_tts"
                         if all(isinstance(item, CloudTtsOutput)
                                for item in result.outputs)
                         else "google_vertex_ai")
    if (set(result.receipt) != dispatch_keys
            or result.receipt.get("attemptId") != plan.fence.attempt_id
            or result.receipt.get("requestSha256")
            != plan.authority.request_sha256
            or result.receipt.get("provider") != expected_provider
            or result.receipt.get("state") != "completed"
            or result.receipt.get("providerOperation") is not None
            or result.receipt.get("outputSha256")
            != [item.sha256 for item in result.outputs]
            or (result.receipt.get("usage") is not None
                and not isinstance(result.receipt.get("usage"), dict))):
        raise ValueError("Dispatch Google no coincide con el manifiesto.")
    rebuilt = google_staging_plan_v2(
        result, plan.artifacts[0].draft.upload.expected.bucket,
        plan.authority, plan.fence)

    def identity(item):
        draft = item.draft
        return (item.output_ordinal, item.artifact_ordinal,
                draft.asset_id, draft.role, draft.mime_type, draft.sha256,
                draft.metadata, draft.lineage, draft.upload.expected)

    if (len(rebuilt.artifacts) != len(plan.artifacts)
            or tuple(identity(item) for item in rebuilt.artifacts)
            != tuple(identity(item) for item in plan.artifacts)):
        raise ValueError("El plan Google no coincide con los outputs originales.")
    outputs = []
    for item, receipt in zip(plan.artifacts, receipts):
        draft, expected = item.draft, item.draft.upload.expected
        if (not isinstance(receipt, StorageReceipt)
                or asdict(receipt) != {
                    "bucket": expected.bucket, "name": expected.name,
                    "generation": receipt.generation,
                    "mime_type": expected.mime_type,
                    "byte_size": expected.byte_size,
                    "sha256": expected.sha256,
                } or receipt.generation <= 0):
            raise ValueError("Recibo de staging Google no válido.")
        outputs.append({
            "outputOrdinal": item.output_ordinal,
            "artifactOrdinal": item.artifact_ordinal,
            "assetId": draft.asset_id, "role": draft.role,
            "mimeType": draft.mime_type,
            "byteSize": receipt.byte_size, "sha256": draft.sha256,
            "stagingStorageReceipt": asdict(receipt),
            "metadata": draft.metadata, "lineage": draft.lineage,
        })
    snapshot = {
        "schemaVersion": 2, "kind": "google_staging_manifest",
        "authority": authority, "fence": fence,
        "dispatchReceipt": result.receipt,
        "preflightReceiptSha256": preflight.sha256,
        "usage": result.receipt.get("usage"), "outputs": outputs,
        "publicationAuthorized": False,
    }
    body = canonical_json(snapshot).encode()
    manifest_sha = canonical_sha256(snapshot)
    if sha256(body).hexdigest() != manifest_sha:
        raise ValueError("El manifiesto Google no es canónico.")
    bucket = plan.artifacts[0].draft.upload.expected.bucket
    name = (f"creative/staging/google/{authority['ownerUserId']}/"
            f"{fence['attemptId']}/manifest/{manifest_sha}.json")
    upload = _manifest_upload(bucket, name, body)
    return GoogleStagingManifestPlan(snapshot, manifest_sha, upload)

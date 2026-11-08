"""DTOs internos para preparar Craft sin ejecutar ni publicar resultados."""

from dataclasses import asdict, dataclass
from decimal import Decimal
from hashlib import sha256
import json
from typing import Any


CRAFT_CONTAINER_INPUT_ROOT = "/work/inputs"


def canonical_sha256(value: Any) -> str:
    def encode(item: object) -> str:
        if isinstance(item, Decimal):
            return str(item)
        raise TypeError(type(item).__name__)
    payload = json.dumps(value, ensure_ascii=False, sort_keys=True,
                         separators=(",", ":"), allow_nan=False,
                         default=encode)
    return sha256(payload.encode()).hexdigest()


@dataclass(frozen=True)
class EngineBinding:
    name: str
    version: str
    engine_job_id: int | None = None


@dataclass(frozen=True)
class StorageReceiptBinding:
    bucket: str
    name: str
    generation: int
    mime_type: str
    byte_size: int
    sha256: str


@dataclass(frozen=True)
class MediaMetadata:
    width_pixels: int | None
    height_pixels: int | None
    frame_rate: dict | None
    duration_seconds: float | None
    sample_rate_hz: int | None
    channels: int | None
    samples_per_channel: int | None
    encoding: str | None
    has_alpha: bool
    frame_count: int | None = None
    manifest_sha256: str | None = None
    bundle_plan_sha256: str | None = None
    format: str | None = None


@dataclass(frozen=True)
class ResolvedAsset:
    asset_id: str
    owner_user_id: str
    owner_project_id: str | None
    asset_revision: int
    kind: str
    mime_type: str
    byte_size: int
    sha256: str
    origin: str
    lineage: dict | None
    storage_receipt: StorageReceiptBinding
    authorization_state: str
    media: MediaMetadata
    mount_name: str
    materialization: dict | None = None


@dataclass(frozen=True)
class CraftIdentity:
    user_id: str
    google_subject: str
    thread_id: str
    uonify_project_id: str | None
    google_cloud_project_id: str


@dataclass(frozen=True)
class CraftPlanBinding:
    creative_plan_id: str
    expected_plan_revision: int
    snapshot: dict
    snapshot_sha256: str
    skill_version: str


@dataclass(frozen=True)
class CraftAuthorization:
    mode: str
    receipt_id: str | None
    max_external_spend_usd: Decimal
    payer: str
    quote_binding_sha256: str | None = None
    quote_sha256: str | None = None
    costs_snapshot_sha256: str | None = None
    quote_max_total_usd: Decimal | None = None
    quote_expires_at: str | None = None


@dataclass(frozen=True)
class CraftLimits:
    cpu_cores: int
    memory_bytes: int
    wall_seconds: int
    output_bytes: int
    network_access: bool
    google_credentials: bool


@dataclass(frozen=True)
class ResolvedCraftJob:
    schema_version: int
    job_id: str
    intent_id: str
    origin_request_id: str
    identity: CraftIdentity
    plan: CraftPlanBinding
    target: dict
    engine: EngineBinding
    operation: str
    inputs: tuple[ResolvedAsset, ...]
    input_manifest_sha256: str
    authorization: CraftAuthorization
    limits: CraftLimits


@dataclass(frozen=True)
class PreflightBlocker:
    code: str
    field: str
    detail: str


@dataclass(frozen=True)
class CraftPreflight:
    schema_version: int
    ready: bool
    job_id: str
    engine: EngineBinding
    operation: str
    job_binding_sha256: str
    capability_matrix_sha256: str
    contract_schema_sha256: str
    recipe_sha256: str
    resolved_inputs: tuple[dict, ...]
    external_generation_cost_usd: float
    craft_compute_cost_state: str
    blockers: tuple[PreflightBlocker, ...]


@dataclass(frozen=True)
class CraftCommand:
    id: str
    params: dict


@dataclass(frozen=True)
class CraftAdapterPlan:
    schema_version: int
    job_id: str
    input_manifest_sha256: str
    engine: EngineBinding
    operation: str
    job_binding_sha256: str
    inputs: tuple[dict, ...]
    commands: tuple[CraftCommand, ...]
    native_project_relative_path: str
    output_relative_path: str
    plan_sha256: str


@dataclass(frozen=True)
class CraftAttempt:
    job_id: str
    attempt_id: str
    lease_token: str


@dataclass(frozen=True)
class CandidateAcceptance:
    accepted: bool
    publication_authorized: bool
    candidate_result_sha256: str | None
    blockers: tuple[PreflightBlocker, ...]


def _media(value: dict) -> MediaMetadata:
    return MediaMetadata(
        value.get("widthPixels"), value.get("heightPixels"), value.get("frameRate"),
        value.get("durationSeconds"), value.get("sampleRateHz"), value.get("channels"),
        value.get("samplesPerChannel"), value.get("encoding"),
        bool(value.get("hasAlpha", False)),
        value.get("frameCount"), value.get("manifestSha256"),
        value.get("bundlePlanSha256"), value.get("format"),
    )


def _exact(value: object, fields: set[str], label: str) -> dict:
    if not isinstance(value, dict) or set(value) != fields:
        raise ValueError(f"{label} debe contener exactamente {sorted(fields)}.")
    return value


def resolved_craft_job(value: dict) -> ResolvedCraftJob:
    """Convierte el envelope resuelto; la validación de autoridad vive en preflight."""
    _exact(value, {"schemaVersion", "jobId", "intentId", "originRequestId",
                   "identity", "plan", "target", "engine", "operation", "inputs",
                   "inputManifestSha256", "authorization", "limits"}, "resolvedJob")
    identity, plan, engine = value["identity"], value["plan"], value["engine"]
    authorization, limits = value["authorization"], value["limits"]
    _exact(identity, {"userId", "googleSubject", "threadId", "uonifyProjectId",
                      "googleCloudProjectId"}, "identity")
    _exact(plan, {"creativePlanId", "expectedPlanRevision", "snapshot",
                  "snapshotSha256", "skillVersion"}, "plan")
    _exact(engine, {"name", "version"}, "engine")
    auth_base = {"mode", "receiptId", "maxExternalSpendUsd", "payer"}
    auth_quote = {"quoteBindingSha256", "quoteSha256", "costsSnapshotSha256",
                  "quoteMaxTotalUsd", "quoteExpiresAt"}
    if not isinstance(authorization, dict) or set(authorization) not in (
            auth_base, auth_base | auth_quote):
        raise ValueError("authorization no coincide con el contrato v1.")
    _exact(limits, {"cpuCores", "memoryBytes", "wallSeconds", "outputBytes",
                    "networkAccess", "googleCredentials"}, "limits")
    _exact(value["target"], {"productId", "expectedProductRevision", "editProject"},
           "target")
    _exact(value["target"]["editProject"], {"mode", "id", "expectedRevision"},
           "target.editProject")
    if not isinstance(value["inputs"], list):
        raise ValueError("inputs debe ser una lista cerrada.")
    inputs = []
    for item in value["inputs"]:
        asset_fields = {"assetId", "ownerUserId", "ownerProjectId",
                        "assetRevision", "kind", "mimeType", "bytes", "sha256",
                        "origin", "lineage", "storageReceipt",
                        "authorizationState", "media", "mountName"}
        if not isinstance(item, dict) or set(item) not in (
                asset_fields, asset_fields | {"materialization"}):
            raise ValueError("resolvedAsset debe contener exactamente el contrato v1.")
        receipt = item["storageReceipt"]
        _exact(receipt, {"bucket", "name", "generation", "mimeType", "byteSize",
                         "sha256"}, "storageReceipt")
        media_fields = {"widthPixels", "heightPixels", "frameRate",
                        "durationSeconds", "sampleRateHz", "channels",
                        "samplesPerChannel", "encoding", "hasAlpha"}
        sequence_fields = {"frameCount", "manifestSha256",
                           "bundlePlanSha256", "format"}
        allowed_media = (media_fields | sequence_fields
                         if item["kind"] == "image_sequence" else media_fields)
        _exact(item["media"], allowed_media, "media")
        materialization = item.get("materialization")
        if materialization is not None:
            _exact(materialization, {
                "schemaVersion", "kind", "assetId", "assetRevision",
                "snapshotSha256", "workerId", "leaseToken", "inputRoot",
                "containerInputRoot",
                "mountName", "firstFrameRelativePath",
                "firstFrameSha256", "frameCount", "unpackedBytes",
                "bundleGeneration", "bundleSha256", "manifestSha256",
                "bundlePlanSha256", "receiptSha256"}, "materialization")
            if materialization["containerInputRoot"] != CRAFT_CONTAINER_INPUT_ROOT:
                raise ValueError("materialization no corresponde al namespace Craft.")
        inputs.append(ResolvedAsset(
            item["assetId"], item["ownerUserId"], item.get("ownerProjectId"),
            item["assetRevision"], item["kind"], item["mimeType"], item["bytes"],
            item["sha256"], item["origin"], item.get("lineage"),
            StorageReceiptBinding(receipt["bucket"], receipt["name"],
                                  receipt["generation"], receipt["mimeType"],
                                  receipt["byteSize"], receipt["sha256"]),
            item["authorizationState"], _media(item["media"]), item["mountName"],
            materialization,
        ))
    return ResolvedCraftJob(
        value["schemaVersion"], value["jobId"], value["intentId"],
        value["originRequestId"],
        CraftIdentity(identity["userId"], identity["googleSubject"],
                      identity["threadId"], identity.get("uonifyProjectId"),
                      identity["googleCloudProjectId"]),
        CraftPlanBinding(plan["creativePlanId"], plan["expectedPlanRevision"],
                         plan["snapshot"], plan["snapshotSha256"],
                         plan["skillVersion"]),
        value["target"], EngineBinding(engine["name"], engine["version"]),
        value["operation"], tuple(inputs), value["inputManifestSha256"],
        CraftAuthorization(authorization["mode"], authorization.get("receiptId"),
                           Decimal(str(authorization["maxExternalSpendUsd"])),
                           authorization["payer"],
                           authorization.get("quoteBindingSha256"),
                           authorization.get("quoteSha256"),
                           authorization.get("costsSnapshotSha256"),
                           (Decimal(str(authorization["quoteMaxTotalUsd"]))
                            if authorization.get("quoteMaxTotalUsd") is not None else None),
                           authorization.get("quoteExpiresAt")),
        CraftLimits(limits["cpuCores"], limits["memoryBytes"],
                    limits["wallSeconds"], limits["outputBytes"],
                    limits["networkAccess"], limits["googleCredentials"]),
    )


def input_manifest_payload(job: ResolvedCraftJob) -> list[dict]:
    """Reconstruye la huella durable definida por el contrato ART-02."""
    rows = []
    for asset in sorted(job.inputs, key=lambda item: item.asset_id):
        receipt = asset.storage_receipt
        row = {
            "assetId": asset.asset_id,
            "ownerProjectId": asset.owner_project_id,
            "assetRevision": asset.asset_revision,
            "sha256": asset.sha256,
            "bytes": asset.byte_size,
            "kind": asset.kind,
            "mountName": asset.mount_name,
            "storageReceipt": {
                "bucket": receipt.bucket, "name": receipt.name,
                "generation": receipt.generation, "mimeType": receipt.mime_type,
                "byteSize": receipt.byte_size, "sha256": receipt.sha256,
            },
        }
        if asset.materialization is not None:
            row["materialization"] = asset.materialization
        rows.append(row)
    return rows


def craft_input_path(asset: ResolvedAsset) -> str:
    materialization = asset.materialization
    if asset.kind == "image_sequence" and isinstance(materialization, dict):
        root = materialization.get("containerInputRoot")
        if root != CRAFT_CONTAINER_INPUT_ROOT:
            raise ValueError("El mount no corresponde al namespace Craft.")
        return (f'{root}/{materialization["mountName"]}/'
                f'{materialization["firstFrameRelativePath"]}')
    return f"/work/inputs/{asset.mount_name}"


def craft_input_expected_sha256(asset: ResolvedAsset) -> str:
    if asset.kind == "image_sequence" and isinstance(asset.materialization, dict):
        return asset.materialization["firstFrameSha256"]
    return asset.sha256


def resolved_job_binding_sha256(job: ResolvedCraftJob) -> str:
    """Liga todo el job resuelto; impide reutilizar preflight tras cualquier cambio."""
    return canonical_sha256(asdict(job))

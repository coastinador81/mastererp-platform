"""Preflight puro y fail-closed para jobs Craft resueltos por servidor."""
from pathlib import PurePosixPath
from decimal import Decimal
from dataclasses import asdict
from datetime import datetime, timedelta, timezone
import re
from uuid import UUID
from .craft_capabilities import (CAPABILITY_MATRIX_SHA256,
                                 CRAFT_CONTRACT_SCHEMA_SHA256, capability_for)
from .craft_contracts import (CraftPreflight, PreflightBlocker, ResolvedCraftJob,
                              canonical_sha256, craft_input_path,
                              input_manifest_payload,
                              resolved_job_binding_sha256)
from .creative_edit_recipe import EDIT_RECIPE
from .creative_composite_quote import (ExecutionBinding, RequestOperationBinding,
                                       canonical_json, composite_quote_readiness)
_SHA = re.compile(r"[0-9a-f]{64}\Z")
def _block(items: list, code: str, field: str, detail: str) -> None:
    items.append(PreflightBlocker(code, field, detail))
def _uuid(value: object) -> bool:
    try:
        UUID(str(value))
        return True
    except (ValueError, TypeError, AttributeError):
        return False
def _safe_mount(name: object) -> bool:
    if not isinstance(name, str) or not name or len(name) > 128:
        return False
    path = PurePosixPath(name)
    return path.name == name and name not in (".", "..") and "\\" not in name
def _safe_relative(name: object) -> bool:
    if not isinstance(name, str) or not name or len(name) > 240 or "\\" in name:
        return False
    path = PurePosixPath(name)
    return not path.is_absolute() and all(part not in ("", ".", "..")
                                          for part in path.parts)

def _positive_int(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value > 0


def expected_composite_quote_binding(job: ResolvedCraftJob) -> str:
    snapshot = job.plan.snapshot
    recipe = snapshot.get("recipe", {})
    sources = recipe.get("sources", {}) if isinstance(recipe, dict) else {}
    operations = tuple(RequestOperationBinding(
        item["operationId"], item["ordinal"], item["unitId"], item["kind"],
        item["requestSha256"], item["model"], item["endpoint"],
        canonical_json(item["requestSnapshot"]))
        for item in snapshot.get("requestOperations", ()))
    binding = ExecutionBinding(
        job.plan.creative_plan_id, job.plan.expected_plan_revision,
        sources.get("sourcePlanSha256", snapshot.get("sourcePlanSha256", "")),
        sources.get("executionSnapshotSha256",
                    snapshot.get("executionSnapshotSha256", "")),
        snapshot.get("recipeSha256", canonical_sha256(recipe)),
        snapshot.get("quoteInputManifestSha256", job.input_manifest_sha256),
        snapshot.get("requestGroupSha256", ""), operations,
        job.engine.name, job.engine.version, job.operation,
        canonical_sha256(asdict(job.limits)),
    )
    return composite_quote_readiness(binding, ()).binding_sha256


def _referenced_assets(recipe: dict) -> tuple[tuple[str, str], ...]:
    result = []
    for row in recipe.get("shots", []) if isinstance(recipe.get("shots", []), list) else []:
        if isinstance(row, dict):
            result.append((row.get("assetId"), "visual"))
    for row in recipe.get("overlays", []) if isinstance(recipe.get("overlays", []), list) else []:
        if isinstance(row, dict):
            result.append((row.get("assetId"), "image"))
    for key in ("voice", "music"):
        row = recipe.get(key)
        if isinstance(row, dict):
            result.append((row.get("assetId"), "audio"))
    return tuple(result)


def _finish(job: ResolvedCraftJob, recipe: dict, resolved: list,
            blockers: list[PreflightBlocker]) -> CraftPreflight:
    return CraftPreflight(
        1, not blockers, job.job_id, job.engine, job.operation,
        resolved_job_binding_sha256(job), CAPABILITY_MATRIX_SHA256,
        CRAFT_CONTRACT_SCHEMA_SHA256, canonical_sha256(recipe), tuple(resolved),
        0.0, "unknown_until_infrastructure_quote", tuple(blockers),
    )


def _default_transform(value, *, allow_position: bool) -> bool:
    return (value.anchor.x == 0 and value.anchor.y == 0
            and (allow_position or (value.position.x == 0 and value.position.y == 0))
            and value.scalePercent.x == value.scalePercent.y == 100
            and value.rotationDegrees == 0 and value.opacityPercent == 100)


def _validate_canonical_recipe(job: ResolvedCraftJob, recipe: dict,
                               blockers: list) -> object | None:
    try:
        parsed = EDIT_RECIPE.validate_python(recipe)
    except ValueError:
        _block(blockers, "invalid_recipe_shape", "plan.snapshot.recipe",
               "La receta no valida contra creative_edit_recipe v1.")
        return None
    normalized = parsed.model_dump(mode="json")
    snapshot = job.plan.snapshot
    if (normalized != recipe or snapshot.get("recipeSha256") != canonical_sha256(normalized)
            or snapshot.get("readyForAdapter") is not True):
        _block(blockers, "canonical_recipe_mismatch", "plan.snapshot",
               "Falta el snapshot normalizado y ligado por bind_edit_recipe.")
    expected = {"image_edit": ("photocraft", "image_edit"),
                "motion_graphics": ("effectcraft", "motion_graphics"),
                "video_assemble": ("filmcraft", "video_export")}
    if expected.get(parsed.kind) != (job.engine.name, job.operation):
        _block(blockers, "recipe_operation_mismatch", "plan.snapshot.recipe",
               "Kind/adapterOperation no corresponden al motor y operación.")
    if parsed.adapterOperation != job.operation or parsed.sources.skillVersion != job.plan.skill_version:
        _block(blockers, "recipe_source_mismatch", "plan.snapshot.recipe.sources",
               "La receta no corresponde a skill/operación del job.")
    by_id = {item.asset_id: item for item in job.inputs}
    if {str(item.assetId) for item in parsed.assets} != set(by_id):
        _block(blockers, "asset_set_mismatch", "plan.snapshot.recipe.assets",
               "Assets canónicos y resueltos no coinciden.")
    for item in parsed.assets:
        asset = by_id.get(str(item.assetId))
        receipt = item.receipt
        if asset is None:
            continue
        if (item.revision != asset.asset_revision or item.kind != asset.kind
                or item.widthPixels != asset.media.width_pixels
                or item.heightPixels != asset.media.height_pixels
                or item.durationSeconds != asset.media.duration_seconds
                or (item.frameRate.model_dump(mode="json") if item.frameRate else None)
                != asset.media.frame_rate
                or item.sampleRateHz != asset.media.sample_rate_hz
                or item.channels != asset.media.channels or item.encoding != asset.media.encoding
                or item.frameCount != asset.media.frame_count
                or item.manifestSha256 != asset.media.manifest_sha256
                or item.bundlePlanSha256 != asset.media.bundle_plan_sha256
                or item.format != asset.media.format
                or receipt.bucket != asset.storage_receipt.bucket
                or receipt.name != asset.storage_receipt.name
                or receipt.generation != asset.storage_receipt.generation
                or receipt.mimeType != asset.storage_receipt.mime_type
                or receipt.byteSize != asset.storage_receipt.byte_size
                or receipt.sha256 != asset.storage_receipt.sha256):
            _block(blockers, "canonical_asset_mismatch", "plan.snapshot.recipe.assets",
                   "Asset/revisión/metadata/recibo difieren del job resuelto.")
    edit_target = job.target.get("editProject", {})
    if (parsed.target.mode != edit_target.get("mode")
            or (str(parsed.target.targetId) if parsed.target.targetId else None) != edit_target.get("id")
            or parsed.target.expectedRevision != edit_target.get("expectedRevision")):
        _block(blockers, "target_mismatch", "plan.snapshot.recipe.target",
               "Target/revisión no coinciden con el job.")

    if parsed.kind == "image_edit":
        source_layers = [item for item in parsed.layers if item.kind == "source"]
        if (len(parsed.assets) != 1 or len(source_layers) != 1 or len(parsed.layers) != 1
                or not _default_transform(source_layers[0].transform, allow_position=False)
                or parsed.canvas.widthPixels != source_layers[0].crop.widthPixels
                or parsed.canvas.heightPixels != source_layers[0].crop.heightPixels):
            _block(blockers, "unsupported_photo_recipe", "plan.snapshot.recipe",
                   "Photo ART-02 admite una capa fuente, crop y transform neutro.")
    elif parsed.kind == "motion_graphics":
        rate = parsed.canvas.frameRate
        assets = [item for item in parsed.layers if item.kind == "asset"]
        texts = [item for item in parsed.layers if item.kind == "text"]
        styles_ok = all(
            item.style.fontFamily == "default" and item.style.fontFallback == "default"
            and item.style.weight == 400 and item.style.lineHeight == 1
            and item.style.tracking == 0 and item.style.alignment == "left"
            and item.style.stroke is None and item.style.fill.endswith("FF")
            and item.style.box.xPixels == item.style.box.yPixels == 0
            and item.style.box.widthPixels == parsed.canvas.widthPixels
            and item.style.box.heightPixels == parsed.canvas.heightPixels
            for item in texts)
        layers_ok = (len(assets) <= 1 and len(texts) == 1
                     and len(parsed.layers) == len(assets) + len(texts)
                     and all(item.inFrame == 0
                             and item.outFrame == parsed.canvas.durationFrames
                             and _default_transform(item.transform,
                                                    allow_position=item.kind == "text")
                             for item in parsed.layers))
        keys_ok = all(item.layerId == texts[0].layerId
                      and item.property == "opacityPercent"
                      and item.interpolation == "linear" for item in parsed.keyframes)
        if (rate.numerator != 25 or rate.denominator != 1
                or not layers_ok or not styles_ok or not keys_ok):
            _block(blockers, "unsupported_effect_recipe", "plan.snapshot.recipe",
                   "Effect ART-02 admite asset opcional, un texto, 25fps y opacidad lineal.")
    return parsed


def preflight_craft_job(job: ResolvedCraftJob) -> CraftPreflight:
    blockers: list[PreflightBlocker] = []
    capability = None
    try:
        capability = capability_for(job.engine.name, job.engine.version, job.operation)
    except ValueError as error:
        _block(blockers, "unsupported_capability", "engine", str(error))

    for field, value in (("jobId", job.job_id), ("intentId", job.intent_id),
                         ("originRequestId", job.origin_request_id),
                         ("identity.userId", job.identity.user_id),
                         ("plan.creativePlanId", job.plan.creative_plan_id)):
        if not _uuid(value):
            _block(blockers, "invalid_uuid", field, "Debe ser UUID.")
    if job.schema_version != 1:
        _block(blockers, "unsupported_schema", "schemaVersion", "Solo se admite v1.")
    if (job.authorization.mode != "approved"
            or job.authorization.payer not in ("platform", "connected_user")
            or not _uuid(job.authorization.receipt_id)):
        _block(blockers, "missing_authorization", "authorization.receiptId",
               "La ejecución requiere modo approved, pagador permitido y recibo durable.")
    if job.authorization.max_external_spend_usd != Decimal("0"):
        _block(blockers, "external_spend_not_zero", "authorization.maxExternalSpendUsd",
               "Craft solo puede consumir entradas ya generadas en este adaptador.")
    authorization = job.authorization
    try:
        quote_expires = datetime.fromisoformat(authorization.quote_expires_at)
        expected_quote_binding = expected_composite_quote_binding(job)
    except (KeyError, TypeError, ValueError):
        quote_expires, expected_quote_binding = None, None
    now = datetime.now(timezone.utc)
    if (expected_quote_binding is None
            or authorization.quote_binding_sha256 != expected_quote_binding
            or not isinstance(authorization.quote_sha256, str)
            or not _SHA.fullmatch(authorization.quote_sha256)
            or not isinstance(authorization.costs_snapshot_sha256, str)
            or not _SHA.fullmatch(authorization.costs_snapshot_sha256)
            or authorization.quote_max_total_usd is None
            or not authorization.quote_max_total_usd.is_finite()
            or authorization.quote_max_total_usd <= 0
            or quote_expires is None or quote_expires.tzinfo is None
            or not now < quote_expires <= now + timedelta(days=1)):
        _block(blockers, "invalid_composite_quote", "authorization",
               "Falta un quote compuesto vigente ligado a receta, inputs, motor y límites.")
    if job.plan.snapshot_sha256 != canonical_sha256(job.plan.snapshot):
        _block(blockers, "plan_snapshot_mismatch", "plan.snapshotSha256",
               "El snapshot del plan cambió después de ser ligado.")
    if (not _SHA.fullmatch(job.input_manifest_sha256)
            or job.input_manifest_sha256 != canonical_sha256(input_manifest_payload(job))):
        _block(blockers, "input_manifest_mismatch", "inputManifestSha256",
               "El manifest de inputs no coincide con sus assets y recibos.")
    limits = job.limits
    if limits.network_access or limits.google_credentials:
        _block(blockers, "isolation_required", "limits",
               "Craft debe ejecutarse sin red ni credenciales Google.")
    if (not all(_positive_int(value) for value in (
            limits.cpu_cores, limits.memory_bytes, limits.wall_seconds, limits.output_bytes))
            or not (1 <= limits.cpu_cores <= 2
                    and 256 * 1024**2 <= limits.memory_bytes <= 2 * 1024**3
                    and 1 <= limits.wall_seconds <= 900
                    and 1 <= limits.output_bytes <= 2 * 1024**3)):
        _block(blockers, "invalid_limits", "limits", "Límites fuera del perfil ART-02.")

    seen_assets, seen_mounts = set(), set()
    resolved = []
    by_id = {}
    for index, asset in enumerate(job.inputs):
        field = f"inputs[{index}]"
        asset_key = asset.asset_id if isinstance(asset.asset_id, str) else repr(asset.asset_id)
        by_id[asset_key] = asset
        if asset_key in seen_assets or asset.mount_name in seen_mounts:
            _block(blockers, "duplicate_input", field, "Asset o mountName repetido.")
        seen_assets.add(asset_key)
        seen_mounts.add(asset.mount_name)
        if not _uuid(asset.asset_id) or not _positive_int(asset.asset_revision):
            _block(blockers, "invalid_asset", field, "ID o revisión de asset no válidos.")
        if (asset.owner_user_id != job.identity.user_id
                or asset.owner_project_id != job.identity.uonify_project_id):
            _block(blockers, "ownership_mismatch", field,
                   "El asset no pertenece al usuario/proyecto del job.")
        if asset.authorization_state != "allowed":
            _block(blockers, "asset_not_authorized", field,
                   "El asset está revocado, retenido o no autorizado.")
        sequence_supported = (asset.kind == "image_sequence"
                              and job.engine.name == "filmcraft"
                              and job.operation == "video_export")
        if (capability and asset.mime_type not in capability.input_mime_types
                and not sequence_supported):
            _block(blockers, "unsupported_mime", field, "MIME no admitido por el motor.")
        receipt = asset.storage_receipt
        expected_prefix = (f"creative/users/{job.identity.user_id}/assets/"
                           f"{asset.asset_id}/{asset.sha256}.")
        if (not _positive_int(receipt.generation)
                or not _positive_int(receipt.byte_size)
                or not _positive_int(asset.byte_size)
                or not isinstance(receipt.bucket, str) or not receipt.bucket
                or not isinstance(receipt.name, str) or not receipt.name
                or not isinstance(receipt.sha256, str)
                or not isinstance(asset.sha256, str)
                or receipt.mime_type != asset.mime_type
                or receipt.byte_size != asset.byte_size or receipt.sha256 != asset.sha256
                or not receipt.name.startswith(expected_prefix)
                or not _SHA.fullmatch(asset.sha256)):
            _block(blockers, "receipt_mismatch", field + ".storageReceipt",
                   "Recibo, generación o huella no coinciden con el asset resuelto.")
        if not _safe_mount(asset.mount_name):
            _block(blockers, "unsafe_mount", field + ".mountName",
                   "mountName debe ser un basename generado por servidor.")
        media = asset.media
        if asset.kind in ("image", "video", "image_sequence") and not (
                _positive_int(media.width_pixels) and _positive_int(media.height_pixels)):
            _block(blockers, "incomplete_media", field + ".media",
                   "El medio visual necesita ancho y alto.")
        if asset.kind == "audio" and not (
                isinstance(media.duration_seconds, (int, float))
                and not isinstance(media.duration_seconds, bool)
                and media.duration_seconds > 0 and _positive_int(media.sample_rate_hz)
                and _positive_int(media.channels)):
            _block(blockers, "incomplete_media", field + ".media",
                   "El audio necesita duración, sample rate y canales.")
        if asset.kind == "image_sequence":
            value = asset.materialization
            expected = {
                "schema_version": 1, "asset_id": asset.asset_id,
                "asset_revision": asset.asset_revision,
                "snapshot_sha256": value.get("snapshotSha256") if isinstance(value, dict) else None,
                "bundle_generation": receipt.generation,
                "bundle_sha256": asset.sha256,
                "manifest_sha256": media.manifest_sha256,
                "bundle_plan_sha256": media.bundle_plan_sha256,
                "worker_id": value.get("workerId") if isinstance(value, dict) else None,
                "lease_token": value.get("leaseToken") if isinstance(value, dict) else None,
                "input_root": value.get("inputRoot") if isinstance(value, dict) else None,
                "container_input_root": value.get("containerInputRoot") if isinstance(value, dict) else None,
                "mount_name": value.get("mountName") if isinstance(value, dict) else None,
                "first_frame_relative_path": value.get("firstFrameRelativePath") if isinstance(value, dict) else None,
                "first_frame_sha256": value.get("firstFrameSha256") if isinstance(value, dict) else None,
                "frame_count": media.frame_count,
                "unpacked_bytes": value.get("unpackedBytes") if isinstance(value, dict) else None,
            }
            if (not isinstance(value, dict) or value.get("schemaVersion") != 1
                    or value.get("kind") != "image_sequence"
                    or value.get("assetId") != asset.asset_id
                    or value.get("assetRevision") != asset.asset_revision
                    or not _SHA.fullmatch(str(value.get("snapshotSha256", "")))
                    or not isinstance(value.get("workerId"), str)
                    or not value.get("workerId")
                    or not _uuid(value.get("leaseToken"))
                    or not isinstance(value.get("inputRoot"), str)
                    or not value.get("inputRoot", "").startswith("/")
                    or value.get("containerInputRoot") != "/work/inputs"
                    or value.get("bundleGeneration") != receipt.generation
                    or value.get("bundleSha256") != asset.sha256
                    or value.get("manifestSha256") != media.manifest_sha256
                    or value.get("bundlePlanSha256") != media.bundle_plan_sha256
                    or value.get("frameCount") != media.frame_count
                    or not _positive_int(value.get("unpackedBytes"))
                    or not _safe_mount(value.get("mountName"))
                    or not _safe_relative(value.get("firstFrameRelativePath"))
                    or not _SHA.fullmatch(str(value.get("firstFrameSha256", "")))
                    or canonical_sha256(expected) != value.get("receiptSha256")):
                _block(blockers, "invalid_image_sequence_mount", field + ".materialization",
                       "La secuencia no tiene un mount íntegro ligado al bundle.")
        resolved.append({"assetId": asset.asset_id, "assetRevision": asset.asset_revision,
                         "storageGeneration": receipt.generation,
                         "sha256": asset.sha256,
                         "inputPath": craft_input_path(asset)})

    recipe = job.plan.snapshot.get("recipe") if isinstance(job.plan.snapshot, dict) else None
    if not isinstance(recipe, dict):
        _block(blockers, "missing_recipe", "plan.snapshot.recipe", "Falta receta cerrada.")
        recipe = {}
    declared_assets = job.plan.snapshot.get("assets", [])
    if (not isinstance(declared_assets, list)
            or any(not isinstance(item, str) for item in declared_assets)
            or set(declared_assets) != set(by_id)
            or len(declared_assets) != len(set(declared_assets))):
        _block(blockers, "asset_set_mismatch", "plan.snapshot.assets",
               "El conjunto cerrado del plan no coincide con los inputs resueltos.")
    if "kind" in recipe:
        _validate_canonical_recipe(job, recipe, blockers)
        return _finish(job, recipe, resolved, blockers)
    if job.operation in ("image_edit", "motion_graphics"):
        _block(blockers, "canonical_recipe_required", "plan.snapshot.recipe",
               "PhotoCraft y EffectCraft requieren creative_edit_recipe v1.")
        return _finish(job, recipe, resolved, blockers)
    if set(recipe) != {"canvas", "masterDurationFrames", "shots", "overlays",
                       "voice", "music"}:
        _block(blockers, "invalid_recipe_shape", "plan.snapshot.recipe",
               "La receta debe usar exactamente el contrato ART-02.")
    duration = recipe.get("masterDurationFrames")
    if not isinstance(duration, int) or isinstance(duration, bool) or duration <= 0:
        _block(blockers, "invalid_duration", "plan.snapshot.recipe.masterDurationFrames",
               "La duración maestra debe ser un entero positivo.")
        duration = 0
    canvas = recipe.get("canvas", {})
    if not isinstance(canvas, dict):
        canvas = {}
    elif set(canvas) != {"widthPixels", "heightPixels", "frameRate"}:
        _block(blockers, "invalid_recipe_shape", "recipe.canvas",
               "Canvas contiene campos desconocidos.")
    rate = canvas.get("frameRate", {})
    if not isinstance(rate, dict):
        rate = {}
    elif set(rate) != {"numerator", "denominator"}:
        _block(blockers, "invalid_recipe_shape", "recipe.canvas.frameRate",
               "Frame rate contiene campos desconocidos.")
    if (not isinstance(canvas.get("widthPixels"), int)
            or not isinstance(canvas.get("heightPixels"), int)
            or canvas.get("widthPixels", 0) <= 0 or canvas.get("heightPixels", 0) <= 0
            or not isinstance(rate.get("numerator"), int)
            or not isinstance(rate.get("denominator"), int)
            or rate.get("numerator", 0) <= 0 or rate.get("denominator", 0) <= 0):
        _block(blockers, "invalid_canvas", "plan.snapshot.recipe.canvas",
               "Canvas y frame rate deben ser enteros positivos.")
    for asset_id, expected_kind in _referenced_assets(recipe):
        asset = by_id.get(asset_id)
        if asset is None:
            _block(blockers, "missing_recipe_asset", "plan.snapshot.recipe",
                   f"La receta referencia el asset no resuelto {asset_id}.")
        elif expected_kind == "visual" and asset.kind not in (
                "image", "video", "image_sequence"):
            _block(blockers, "wrong_asset_kind", "plan.snapshot.recipe", "Shot no visual.")
        elif expected_kind != "visual" and asset.kind != expected_kind:
            _block(blockers, "wrong_asset_kind", "plan.snapshot.recipe",
                   f"Se esperaba un asset {expected_kind}.")
    for group in ("shots", "overlays"):
        rows = recipe.get(group, [])
        if not isinstance(rows, list):
            _block(blockers, "invalid_recipe_shape", f"recipe.{group}",
                   "Debe ser una lista.")
            continue
        for index, row in enumerate(rows):
            if not isinstance(row, dict):
                _block(blockers, "invalid_recipe_shape", f"recipe.{group}[{index}]",
                       "Debe ser un objeto.")
                continue
            expected_fields = ({"assetId", "track", "startFrame", "durationFrames",
                                "sourceInFrame", "sourceFrameRate", "cadencePolicy",
                                "framing"} if group == "shots" else
                               {"assetId", "track", "startFrame", "durationFrames",
                                "alphaMode"})
            if set(row) != expected_fields:
                _block(blockers, "invalid_recipe_shape", f"recipe.{group}[{index}]",
                       "El clip contiene campos desconocidos o incompletos.")
            start, length = row.get("startFrame"), row.get("durationFrames")
            if (not isinstance(start, int) or isinstance(start, bool)
                    or not isinstance(length, int) or isinstance(length, bool)
                    or start < 0 or length <= 0 or start + length > duration):
                _block(blockers, "timeline_out_of_bounds", f"recipe.{group}[{index}]",
                       "El intervalo queda fuera del master.")
            if row.get("track") not in ("V1", "V2"):
                _block(blockers, "wrong_track", f"recipe.{group}[{index}].track",
                       "La secuencia ART-02 admite solo V1 o V2.")
            if group == "shots":
                framing = row.get("framing")
                center = [canvas.get("widthPixels", 0) / 2,
                          canvas.get("heightPixels", 0) / 2]
                if (row.get("sourceInFrame") != 0 or row.get("sourceFrameRate") is not None
                        or not isinstance(framing, dict)
                        or framing.get("mode") != "contain"
                        or framing.get("scalePercent") != 100
                        or framing.get("position") != center
                        or framing.get("crop") is not None):
                    _block(blockers, "unsupported_shot_transform",
                           f"recipe.{group}[{index}]",
                           "Trim, source FPS, crop o encuadre no se traducen aún.")
            elif row.get("alphaMode") != "straight":
                _block(blockers, "unsupported_overlay", f"recipe.{group}[{index}]",
                       "Solo se admite overlay alpha straight.")
    for key in ("voice", "music"):
        row = recipe.get(key)
        if not row:
            continue
        if not isinstance(row, dict):
            _block(blockers, "invalid_recipe_shape", f"recipe.{key}",
                   "Debe ser un objeto o null.")
            continue
        expected_fields = ({"assetId", "track", "startFrame", "durationFrames", "gainDb"}
                           if key == "voice" else
                           {"assetId", "track", "startFrame", "durationFrames", "gainDb",
                            "policy", "fadeStartFrame", "fadeEndFrame",
                            "intentionalSilenceStartFrame"})
        unknown = set(row) - expected_fields
        missing = expected_fields - set(row)
        if unknown or missing:
            _block(blockers, "invalid_recipe_shape", f"recipe.{key}",
                   "El audio contiene campos desconocidos o incompletos.")
        start, length = row.get("startFrame"), row.get("durationFrames")
        if (not isinstance(start, int) or isinstance(start, bool)
                or not isinstance(length, int) or isinstance(length, bool)
                or start < 0 or length <= 0 or start + length > duration):
            _block(blockers, "timeline_out_of_bounds", f"recipe.{key}",
                   "El intervalo de audio queda fuera del master.")
        if row.get("track") not in ("A1", "A2"):
            _block(blockers, "wrong_track", f"recipe.{key}.track",
                   "La secuencia ART-02 admite solo A1 o A2.")
    voice = recipe.get("voice") if isinstance(recipe.get("voice"), dict) else {}
    music = recipe.get("music") if isinstance(recipe.get("music"), dict) else {}
    unimplemented_audio = ({"targetLufs", "autoMatch", "loudness"} & set(voice)
                           or {"ducking", "duckingReductionDb", "duckingFadeSeconds",
                               "autoMatch", "targetLufs", "loudness"} & set(music))
    if unimplemented_audio:
        _block(blockers, "unsupported_audio_policy", "plan.snapshot.recipe",
               "Ducking/autoMatch/loudness deben bloquearse hasta tener traducción cerrada.")

    return _finish(job, recipe, resolved, blockers)

"""Validación local de resultados Craft; nunca persiste ni publica."""

from copy import deepcopy
from pathlib import PurePosixPath
import re

from .craft_capabilities import CAPABILITY_MATRIX_SHA256
from .craft_contracts import (CandidateAcceptance, CraftAdapterPlan, CraftAttempt,
                              PreflightBlocker, ResolvedCraftJob, canonical_sha256,
                              resolved_job_binding_sha256)
from .creative_edit_recipe import EDIT_RECIPE


_SHA = re.compile(r"[0-9a-f]{64}\Z")


def _output_path(value: object) -> bool:
    if not isinstance(value, str) or not value:
        return False
    path = PurePosixPath(value)
    return (not path.is_absolute() and ".." not in path.parts
            and path.parts[:1] == ("out",))


def _artifact(value: object) -> bool:
    return (isinstance(value, dict)
            and isinstance(value.get("bytes"), int)
            and not isinstance(value.get("bytes"), bool)
            and value["bytes"] > 0
            and isinstance(value.get("sha256"), str)
            and _SHA.fullmatch(value["sha256"]) is not None)


def candidate_result_sha256(candidate: dict) -> str:
    """Huella estable del resultado, sin identidad efímera del intento."""
    public = deepcopy(candidate)
    public.pop("attemptId", None)
    public.pop("leaseToken", None)
    engine = public.get("engine")
    if isinstance(engine, dict):
        engine.pop("engineJobId", None)
    return canonical_sha256(public)


def _valid_engine_job_id(value: object) -> bool:
    return (value is None or (isinstance(value, (int, str))
                              and not isinstance(value, bool)))


def _valid_metrics(value: object, media_bytes: int, total_bytes: int) -> bool:
    if not isinstance(value, dict) or set(value) != {
            "wallMs", "cpuMs", "mediaOutputBytes", "totalArtifactBytes"}:
        return False
    wall, cpu = value.get("wallMs"), value.get("cpuMs")
    return (isinstance(wall, int) and not isinstance(wall, bool) and wall >= 0
            and (cpu is None or (isinstance(cpu, int)
                                 and not isinstance(cpu, bool) and cpu >= 0))
            and value.get("mediaOutputBytes") == media_bytes
            and value.get("totalArtifactBytes") == total_bytes)


def _photo_effect_candidate(job: ResolvedCraftJob, attempt: CraftAttempt,
                            adapter: CraftAdapterPlan, candidate: dict
                            ) -> CandidateAcceptance:
    blockers: list[PreflightBlocker] = []

    def reject(code: str, field: str, detail: str) -> None:
        blockers.append(PreflightBlocker(code, field, detail))

    expected_top = {
        "schemaVersion", "jobId", "attemptId", "leaseToken",
        "jobBindingSha256", "inputManifestSha256", "recipeSha256",
        "adapterPlanSha256", "capabilityMatrixSha256", "engine",
        "nativeProject", "outputs", "outputManifestSha256", "preflight",
        "metrics", "publicationAuthorized",
    }
    if set(candidate) != expected_top or candidate.get("schemaVersion") != 1:
        reject("invalid_candidate_shape", "candidate", "Candidate v1 no coincide.")
    if (attempt.job_id != job.job_id or candidate.get("jobId") != job.job_id
            or candidate.get("attemptId") != attempt.attempt_id
            or candidate.get("leaseToken") != attempt.lease_token):
        reject("stale_attempt", "candidate", "Job, intento o lease no coinciden.")
    recipe_sha = canonical_sha256(job.plan.snapshot.get("recipe", {}))
    if (candidate.get("jobBindingSha256") != resolved_job_binding_sha256(job)
            or candidate.get("jobBindingSha256") != adapter.job_binding_sha256
            or candidate.get("inputManifestSha256") != job.input_manifest_sha256
            or candidate.get("recipeSha256") != recipe_sha
            or candidate.get("adapterPlanSha256") != adapter.plan_sha256
            or candidate.get("capabilityMatrixSha256") != CAPABILITY_MATRIX_SHA256):
        reject("snapshot_mismatch", "candidate", "Las huellas canónicas cambiaron.")
    if candidate.get("publicationAuthorized") is not False:
        reject("publication_forbidden", "candidate.publicationAuthorized",
               "El worker no puede autorizar publicación.")

    engine = candidate.get("engine")
    if (not isinstance(engine, dict)
            or set(engine) != {"name", "version", "operation", "engineJobId"}):
        reject("invalid_candidate_shape", "candidate.engine", "Engine v1 no coincide.")
        engine = {}
    if (engine.get("name"), engine.get("version"), engine.get("operation")) != (
            job.engine.name, job.engine.version, job.operation):
        reject("engine_mismatch", "candidate.engine", "Motor, versión u operación cambiaron.")
    if not _valid_engine_job_id(engine.get("engineJobId")):
        reject("invalid_candidate_shape", "candidate.engine.engineJobId",
               "engineJobId solo puede ser diagnóstico escalar.")

    native = candidate.get("nativeProject")
    native_mime = ("application/zip" if job.engine.name == "photocraft"
                   else "application/json")
    if (not _artifact(native) or set(native) != {
            "role", "relativePath", "mimeType", "bytes", "sha256"}
            or native.get("role") != "native_project"
            or native.get("relativePath") != adapter.native_project_relative_path
            or native.get("mimeType") != native_mime):
        reject("invalid_native_project", "candidate.nativeProject",
               "Proyecto nativo no válido.")
        native = {}

    try:
        recipe = EDIT_RECIPE.validate_python(job.plan.snapshot["recipe"])
    except Exception:
        reject("snapshot_mismatch", "candidate.recipeSha256", "La receta dejó de ser válida.")
        recipe = None
    outputs = candidate.get("outputs")
    expected_paths: list[str] = []
    if recipe is not None and job.engine.name == "photocraft":
        expected_paths = [adapter.output_relative_path]
    elif recipe is not None:
        expected_paths = [recipe.output.relativePattern.replace("%05d", f"{index:05d}")
                          for index in range(recipe.output.frameCount)]
    if (not isinstance(outputs, list) or len(outputs) != len(expected_paths)
            or [item.get("relativePath") if isinstance(item, dict) else None
                for item in outputs] != expected_paths):
        reject("missing_output", "candidate.outputs", "Salidas ordenadas no coinciden.")
        outputs = []
    if candidate.get("outputManifestSha256") != canonical_sha256(outputs):
        reject("output_manifest_mismatch", "candidate.outputManifestSha256",
               "La huella del manifest de salida no coincide.")

    sources = [{"assetId": item.asset_id, "revision": item.asset_revision}
               for item in job.inputs]
    total = 0
    for index, output in enumerate(outputs):
        expected_media = {"widthPixels", "heightPixels", "hasAlpha"}
        if job.engine.name == "effectcraft":
            expected_media.add("frameIndex")
        lineage = output.get("lineage") if isinstance(output, dict) else None
        draft = output.get("storageDraft") if isinstance(output, dict) else None
        media = output.get("media") if isinstance(output, dict) else None
        if (not _artifact(output) or set(output) != {
                "role", "relativePath", "mimeType", "bytes", "sha256", "media",
                "lineage", "storageDraft"}
                or output.get("role") not in ("image_master", "rgba_frame")
                or not _output_path(output.get("relativePath"))
                or output.get("mimeType") != "image/png"
                or not isinstance(media, dict) or set(media) != expected_media
                or recipe is None
                or media.get("widthPixels") != recipe.canvas.widthPixels
                or media.get("heightPixels") != recipe.canvas.heightPixels
                or not isinstance(media.get("hasAlpha"), bool)):
            reject("invalid_output", f"candidate.outputs[{index}]", "PNG o media no válidos.")
        if (job.engine.name == "photocraft" and output.get("role") != "image_master"):
            reject("invalid_output", f"candidate.outputs[{index}].role", "Rol Photo inválido.")
        if (job.engine.name == "effectcraft"
                and (output.get("role") != "rgba_frame"
                     or not isinstance(media, dict) or media.get("frameIndex") != index
                     or media.get("hasAlpha") is not True)):
            reject("invalid_output", f"candidate.outputs[{index}].media", "Frame RGBA inválido.")
        if (not isinstance(lineage, dict)
                or set(lineage) != {"sources", "recipeSha256", "jobBindingSha256"}
                or lineage.get("sources") != sources
                or lineage.get("recipeSha256") != recipe_sha
                or lineage.get("jobBindingSha256") != adapter.job_binding_sha256):
            reject("lineage_mismatch", f"candidate.outputs[{index}].lineage",
                   "El linaje no coincide con assets y receta.")
        if (not isinstance(draft, dict)
                or set(draft) != {"state", "relativePath", "mimeType"}
                or draft.get("state") != "candidate_local"
                or draft.get("relativePath") != output.get("relativePath")
                or draft.get("mimeType") != output.get("mimeType")):
            reject("invalid_storage_draft", f"candidate.outputs[{index}].storageDraft",
                   "El borrador local no coincide y no debe inventar receipt.")
        if _artifact(output):
            total += output["bytes"]

    checks = candidate.get("preflight")
    if not isinstance(checks, dict):
        reject("invalid_candidate_shape", "candidate.preflight", "Preflight debe ser objeto.")
        checks = {}
    common_ok = (checks.get("rpcOk") is True and checks.get("nestedFailed") == 0
                 and checks.get("projectReopened") is True
                 and isinstance(checks.get("warnings"), list))
    if recipe is not None and job.engine.name == "photocraft":
        expected_checks = {"rpcOk", "nestedFailed", "projectReopened", "widthPixels",
                           "heightPixels", "layerCount", "warnings"}
        valid_checks = (set(checks) == expected_checks and common_ok
                        and checks.get("widthPixels") == recipe.canvas.widthPixels
                        and checks.get("heightPixels") == recipe.canvas.heightPixels
                        and checks.get("layerCount") == len(recipe.layers))
    elif recipe is not None:
        expected_checks = {"rpcOk", "nestedFailed", "projectReopened",
                           "renderQueueState", "renderedFrames", "expectedFrames",
                           "missingFrames", "rgbaVerified", "firstFrame", "lastFrame",
                           "warnings"}
        valid_checks = (set(checks) == expected_checks and common_ok
                        and checks.get("renderQueueState") == "done"
                        and checks.get("renderedFrames") == recipe.output.frameCount
                        and checks.get("expectedFrames") == recipe.output.frameCount
                        and checks.get("missingFrames") == []
                        and checks.get("rgbaVerified") is True
                        and checks.get("firstFrame") == expected_paths[0]
                        and checks.get("lastFrame") == expected_paths[-1])
    else:
        valid_checks = False
    if not valid_checks:
        reject("invalid_media_result", "candidate.preflight",
               "Reapertura, capas, frames o alfa no son válidos.")

    metrics = candidate.get("metrics")
    artifact_total = total + (native.get("bytes", 0)
                              if isinstance(native.get("bytes"), int) else 0)
    if (not _valid_metrics(metrics, total, artifact_total)
            or artifact_total > job.limits.output_bytes):
        reject("metrics_mismatch", "candidate.metrics", "Bytes o cuota no coinciden.")
    digest = None if blockers else candidate_result_sha256(candidate)
    return CandidateAcceptance(not blockers, False, digest, tuple(blockers))


def _film_candidate(job: ResolvedCraftJob, attempt: CraftAttempt,
                    adapter: CraftAdapterPlan, candidate: dict) -> CandidateAcceptance:
    blockers: list[PreflightBlocker] = []

    def reject(code: str, field: str, detail: str) -> None:
        blockers.append(PreflightBlocker(code, field, detail))

    required = {"schemaVersion", "jobId", "attemptId", "leaseToken", "engine",
                "inputManifestSha256", "nativeProject", "outputs", "preflight", "metrics"}
    if set(candidate) != required or candidate.get("schemaVersion") != 1:
        reject("invalid_candidate_shape", "candidate", "Candidate Film v1 no coincide.")
    if (attempt.job_id != job.job_id or candidate.get("jobId") != job.job_id
            or candidate.get("attemptId") != attempt.attempt_id
            or candidate.get("leaseToken") != attempt.lease_token):
        reject("stale_attempt", "candidate", "Job, intento o lease no coinciden.")
    if (adapter.job_id != job.job_id
            or candidate.get("inputManifestSha256") != job.input_manifest_sha256):
        reject("snapshot_mismatch", "candidate.inputManifestSha256", "Manifest cambiado.")
    if adapter.job_binding_sha256 != resolved_job_binding_sha256(job):
        reject("adapter_binding_mismatch", "adapter.jobBindingSha256", "Job cambiado.")
    engine = candidate.get("engine")
    if (not isinstance(engine, dict)
            or set(engine) != {"name", "version", "engineJobId"}):
        reject("invalid_candidate_shape", "candidate.engine", "Engine v1 no coincide.")
        engine = {}
    if (engine.get("name"), engine.get("version")) != (job.engine.name, job.engine.version):
        reject("engine_mismatch", "candidate.engine", "Motor o versión cambiaron.")
    if not _valid_engine_job_id(engine.get("engineJobId")):
        reject("invalid_candidate_shape", "candidate.engine.engineJobId",
               "engineJobId solo puede ser diagnóstico escalar.")
    checks = candidate.get("preflight")
    check_fields = {"rpcOk", "nestedFailed", "offlineMedia", "warnings",
                    "projectReopened", "decodedVideoFrames", "decodedAudioBuffers"}
    if not isinstance(checks, dict) or set(checks) != check_fields:
        reject("invalid_candidate_shape", "candidate.preflight", "Preflight v1 no coincide.")
        checks = {}
    if (checks.get("rpcOk") is not True or checks.get("nestedFailed") != 0
            or checks.get("offlineMedia") != [] or checks.get("projectReopened") is not True
            or not isinstance(checks.get("decodedVideoFrames"), int)
            or checks.get("decodedVideoFrames", 0) <= 0):
        reject("invalid_media_result", "candidate.preflight", "Decode Film no válido.")
    native = candidate.get("nativeProject")
    if not isinstance(native, dict):
        reject("invalid_candidate_shape", "candidate.nativeProject",
               "Native project debe ser objeto.")
    if (not _artifact(native) or set(native) != {
            "relativePath", "mimeType", "bytes", "sha256", "media"}
            or native.get("relativePath") != adapter.native_project_relative_path
            or native.get("mimeType") != "application/json"):
        reject("invalid_native_project", "candidate.nativeProject", "Proyecto Film inválido.")
        native = {}
    outputs = candidate.get("outputs")
    if not isinstance(outputs, list) or len(outputs) != 1:
        reject("missing_output", "candidate.outputs", "Se exige un master.")
        outputs = []
    elif not isinstance(outputs[0], dict):
        reject("invalid_output", "candidate.outputs[0]", "Master inválido.")
        outputs = []
    total = 0
    if outputs:
        output = outputs[0]
        if (set(output) != {"relativePath", "mimeType", "bytes", "sha256", "media"}
                or not _artifact(output) or not _output_path(output.get("relativePath"))
                or output.get("relativePath") != adapter.output_relative_path
                or output.get("mimeType") != "video/mp4"):
            reject("invalid_output", "candidate.outputs[0]", "Master Film inválido.")
        if _artifact(output):
            total = output["bytes"]
        if total > job.limits.output_bytes:
            reject("output_limit_exceeded", "candidate.outputs", "Salida supera cuota.")
        media = output.get("media") if isinstance(output, dict) else None
        if not isinstance(media, dict):
            reject("invalid_candidate_shape", "candidate.outputs[0].media",
                   "Media debe ser objeto.")
        recipe = job.plan.snapshot["recipe"]
        canvas, canonical = recipe["canvas"], recipe.get("kind") == "video_assemble"
        frames = canvas["durationFrames"] if canonical else recipe["masterDurationFrames"]
        if (not isinstance(media, dict)
                or media.get("widthPixels") != canvas["widthPixels"]
                or media.get("heightPixels") != canvas["heightPixels"]
                or media.get("frameRate") != canvas["frameRate"]
                or checks.get("decodedVideoFrames") != frames):
            reject("output_media_mismatch", "candidate.outputs[0].media", "Media cambió.")
    metrics = candidate.get("metrics")
    if not isinstance(metrics, dict):
        reject("invalid_candidate_shape", "candidate.metrics", "Metrics debe ser objeto.")
    artifact_total = total + (native.get("bytes", 0)
                              if isinstance(native.get("bytes"), int) else 0)
    if (not _valid_metrics(metrics, total, artifact_total)
            or artifact_total > job.limits.output_bytes):
        reject("metrics_mismatch", "candidate.metrics", "Bytes Film no coinciden.")
    digest = None if blockers else candidate_result_sha256(candidate)
    return CandidateAcceptance(not blockers, False, digest, tuple(blockers))


def accept_candidate_result(job: ResolvedCraftJob, attempt: CraftAttempt,
                            adapter: CraftAdapterPlan, candidate: object
                            ) -> CandidateAcceptance:
    if not isinstance(candidate, dict):
        blocker = PreflightBlocker("invalid_candidate_shape", "candidate",
                                   "El candidato debe ser un objeto v1.")
        return CandidateAcceptance(False, False, None, (blocker,))
    if job.engine.name in ("photocraft", "effectcraft"):
        return _photo_effect_candidate(job, attempt, adapter, candidate)
    if job.engine.name == "filmcraft" and job.operation == "video_export":
        return _film_candidate(job, attempt, adapter, candidate)
    blocker = PreflightBlocker("candidate_validation_not_implemented", "candidate",
                               "Motor no admitido.")
    return CandidateAcceptance(False, False, None, (blocker,))

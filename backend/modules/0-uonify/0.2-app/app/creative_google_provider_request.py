"""Liga una petición durable Veo/Omni a su namespace y autoridad exactos."""

from dataclasses import dataclass

from .creative_composite_quote import canonical_sha256
from .creative_google_capabilities import ModelId, veo_model_ids
from .creative_google_generation_authority import (
    GoogleGenerationAuthority, GoogleGenerationFence,
    google_generation_authority_snapshot, google_generation_fence_snapshot)
from .creative_google_provider_namespace import (
    GoogleProviderOutputNamespace, google_provider_output_namespace)
from .creative_request_fingerprint import fingerprint
from .creative_video_contracts import VideoRequest


_OMNI = ModelId.OMNI_11.value
_VEO = veo_model_ids()


@dataclass(frozen=True)
class GoogleProviderRequestBinding:
    request: VideoRequest
    namespace: GoogleProviderOutputNamespace
    snapshot: dict
    sha256: str


def bind_google_provider_request(
        request: VideoRequest, bucket: str,
        authority: GoogleGenerationAuthority,
        fence: GoogleGenerationFence) -> GoogleProviderRequestBinding:
    owner = google_generation_authority_snapshot(authority)
    attempt = google_generation_fence_snapshot(fence)
    namespace = google_provider_output_namespace(bucket, authority, fence)
    exact = fingerprint(request) if isinstance(request, VideoRequest) else None
    if (exact is None or request.model != owner["model"]
            or exact.sha256 != owner["requestSha256"]):
        raise ValueError("Petición durable y autoridad Google no coinciden.")
    if request.model in _VEO:
        endpoint = (
            f"https://us-central1-aiplatform.googleapis.com/v1/projects/"
            f"{owner['googleProject']}/locations/us-central1/publishers/google/"
            f"models/{request.model}:predictLongRunning")
        parameters = request.body.get("parameters")
        # D1 (Veo durable defer-and-inject, 29-10): el `storageUri` NO está en el request aprobado/
        # fingerprinteado (el prefijo §6 sólo existe tras la reserva, post-aprobación; cotizar con
        # output_uri=None lo difiere). La ubicación se INYECTA en el despacho desde el prefijo AUTORITATIVO
        # (dispatch_once, tras el fingerprint check) y la valida el transporte (_require_veo_durable_output
        # storageUri==prefix). Aquí bind sigue COMPUTANDO+anclando el `namespace` (abajo, en el snapshot
        # firmado); el ancla ==persistido la hace `assert_bound_prefix_matches_persisted` (129/134) justo
        # tras bind. Por eso ya NO se exige `storageUri==namespace.uri` en el request (no lo lleva). La rama
        # Omni (:103) queda INTACTA: su contrato con gcs_uri sigue como estaba (su D es un cambio aparte).
        valid = (owner["googleLocation"] == "us-central1"
                 and request.endpoint == endpoint
                 and isinstance(parameters, dict))
    elif request.model == _OMNI:
        endpoint = (f"https://aiplatform.googleapis.com/v1beta1/projects/"
                    f"{owner['googleProject']}/locations/global/interactions")
        formats = request.body.get("response_format")
        output = formats[0] if isinstance(formats, list) and len(formats) == 1 else None
        inputs = request.body.get("input")
        first = inputs[0] if isinstance(inputs, list) and inputs else None
        reference_inputs = inputs[1:] if isinstance(inputs, list) else []
        manifest = request.input_manifest
        config = request.body.get("generation_config")
        video_config = config.get("video_config") if isinstance(config, dict) else None
        legacy_text = (request.mode == "text_to_video_background"
                       and request.body.get("background") is True
                       and request.body.get("store") is True
                       and request.body.get("stream") is False
                       and isinstance(video_config, dict)
                       and video_config.get("task") == "text_to_video")
        task_modes = {
            "reference_to_video": "reference_to_video_background",
            "image_to_video": "image_to_video_background",
            "edit": "edit_background",
        }
        task = video_config.get("task") if isinstance(video_config, dict) else None
        matching_media = (
            isinstance(first, dict) and first.get("type") == "text"
            and first.get("background") is True
            and set(first) == {"background", "type", "text"}
            and request.mode == task_modes.get(task)
            and isinstance(manifest, tuple) and 1 <= len(manifest) <= 13
            and len(manifest) == len(reference_inputs)
            and all(isinstance(item, dict) for item in manifest)
            and all(isinstance(item, dict)
                    and set(item) == {"type", "uri", "mime_type"}
                    for item in reference_inputs)
            and all(source.get("kind") == item.get("type")
                    and source.get("uri") == item.get("uri")
                    and source.get("mimeType") == item.get("mime_type")
                    for source, item in zip(manifest, reference_inputs))
            )
        kinds = tuple(item.get("type") for item in reference_inputs
                      if isinstance(item, dict))
        cardinality = (
            (task == "reference_to_video"
             and set(kinds) <= {"image", "video"}
             and kinds.count("image") <= 10 and kinds.count("video") <= 3)
            or (task == "image_to_video" and len(kinds) in (1, 2)
                and set(kinds) == {"image"})
            or (task == "edit" and kinds == ("video",)))
        durable_media = matching_media and cardinality
        valid = (owner["googleLocation"] == "global"
                 and request.endpoint == endpoint
                 and (legacy_text or durable_media)
                 and isinstance(output, dict)
                 and output.get("delivery") == "uri"
                 and output.get("gcs_uri") == namespace.uri)
    else:
        valid = False
    if not valid:
        raise ValueError("Petición Google no usa su namespace durable exacto.")
    snapshot = {
        "schemaVersion": 1,
        "kind": "google_provider_request_binding",
        "attemptId": attempt["attemptId"],
        "operationId": owner["operationId"],
        "requestSha256": exact.sha256,
        "model": request.model,
        "bucket": namespace.bucket,
        "namePrefix": namespace.name_prefix,
        "uri": namespace.uri,
        "publicationAuthorized": False,
    }
    return GoogleProviderRequestBinding(
        request, namespace, snapshot, canonical_sha256(snapshot))

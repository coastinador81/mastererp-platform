"""Veo 3.1 durable con hasta tres imágenes del mismo sujeto."""

from base64 import b64encode

from .creative_google_capabilities import veo_model_ids
from .creative_video_contracts import (
    VideoMedia, VideoRequest, _check_common, _check_media, _gcs_prefix,
    _manifest)


# H8: derivado de la FUENTE ÚNICA (creative_google_capabilities), no re-listado aquí.
_MODELS = veo_model_ids()
_MAX_TOTAL_IMAGE_BYTES = 20_000_000


def veo_subject_background_request(
        project: str, model: str, prompt: str,
        subject_images: tuple[VideoMedia, ...], output_uri: str, *,
        aspect_ratio: str = "16:9") -> VideoRequest:
    """Prepara referencia de sujeto 1–3, una sola salida 8 s/720p con audio."""
    _check_common(project, prompt)
    if model not in _MODELS:
        raise ValueError("Modelo Veo no comprobado.")
    if not isinstance(subject_images, tuple) or len(subject_images) not in (1, 2, 3):
        raise ValueError("Veo requiere entre una y tres imágenes de sujeto.")
    for image in subject_images:
        _check_media(image)
        if image.kind != "image" or image.mime_type not in (
                "image/png", "image/jpeg"):
            raise ValueError("Veo admite imágenes de sujeto PNG o JPEG.")
    if sum(len(image.data) for image in subject_images) > _MAX_TOTAL_IMAGE_BYTES:
        raise ValueError("Las imágenes de sujeto superan el límite seguro total.")
    hashes = tuple(item["sha256"] for item in _manifest(subject_images))
    if len(set(hashes)) != len(hashes):
        raise ValueError("Cada imagen de sujeto Veo debe ser distinta.")
    if aspect_ratio not in ("16:9", "9:16"):
        raise ValueError("Relación de aspecto Veo no admitida.")
    _gcs_prefix(output_uri)
    instance = {
        "prompt": prompt.strip(),
        "referenceImages": [{
            "image": {
                "bytesBase64Encoded": b64encode(image.data).decode("ascii"),
                "mimeType": image.mime_type,
            },
            "referenceType": "asset",
        } for image in subject_images],
    }
    parameters = {
        "sampleCount": 1,
        "durationSeconds": 8,
        "resolution": "720p",
        "aspectRatio": aspect_ratio,
        "generateAudio": True,
        "personGeneration": "disallow",
        "storageUri": output_uri,
    }
    endpoint = (
        f"https://us-central1-aiplatform.googleapis.com/v1/projects/{project}"
        f"/locations/us-central1/publishers/google/models/"
        f"{model}:predictLongRunning")
    manifest = tuple({**item, "role": "subject_reference", "ordinal": index}
                     for index, item in enumerate(_manifest(subject_images), 1))
    return VideoRequest(endpoint, model, "reference_to_video",
                        {"instances": [instance], "parameters": parameters},
                        manifest)

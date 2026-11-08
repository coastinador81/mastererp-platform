"""Reconstruye una petición Google aprobada sin confiar en su tipo declarado."""

from base64 import b64decode
import json
import re

from .creative_cloud_tts_contracts import (
    ENDPOINT as CLOUD_TTS_ENDPOINT, MODEL as CLOUD_TTS_MODEL,
    cloud_tts_request)
from .creative_google_capabilities import ModelId, veo_model_ids
from .creative_image_contracts import (
    IMAGE_MODELS, ImageMedia, ImageRequest, image_request)
from .creative_image_references import ImageGcsReference, image_reference_request
from .creative_music_contracts import (
    MODEL as LYRIA_MODEL, MusicRequest, music_request)
from .creative_music_references import (
    MusicGcsImageReference, music_image_request)
from .creative_request_fingerprint import fingerprint
from .creative_veo_first_frame import VeoFrameGcsReference, veo_first_frame_request
from .creative_veo_references import veo_subject_background_request
from .creative_video_contracts import VideoMedia, VideoRequest, veo_request
from .creative_voiceover_contracts import MODEL as TTS_MODEL, VoiceoverRequest


_HASH = re.compile(r"[0-9a-f]{64}\Z")
_OMNI = ModelId.OMNI_11
_VEO = veo_model_ids()
_MAX_SNAPSHOT_BYTES = 32_000_000
_LYRIA_ENDPOINT = re.compile(
    r"https://aiplatform\.googleapis\.com/v1beta1/projects/"
    r"([a-z][a-z0-9-]{4,61}[a-z0-9])/locations/global/interactions\Z")


def _reject_constant(value):
    raise ValueError(f"Constante JSON no admitida: {value}")


def _video_mode(model: str, body: dict, manifest: tuple[dict, ...]) -> str:
    if model in _VEO:
        return "reference_to_video" if manifest else "text_to_video"
    if model != _OMNI:
        raise ValueError("Modelo Google no admitido.")
    config = body.get("generation_config")
    video = config.get("video_config") if isinstance(config, dict) else None
    task = video.get("task") if isinstance(video, dict) else None
    if task not in ("text_to_video", "image_to_video", "reference_to_video",
                    "edit", "extend"):
        raise ValueError("Modo Omni no admitido.")
    if body.get("background") is True:
        if task != "text_to_video" or manifest:
            raise ValueError("Modo durable Omni no admitido.")
        return "text_to_video_background"
    inputs = body.get("input")
    first = inputs[0] if isinstance(inputs, list) and inputs else None
    if isinstance(first, dict) and first.get("background") is True:
        if (task == "text_to_video" or not manifest
                or set(first) != {"background", "type", "text"}
                or first.get("type") != "text"):
            raise ValueError("Modo durable Omni no admitido.")
        return f"{task}_background"
    return task


def _voice(endpoint: str, model: str, body: dict) -> VoiceoverRequest:
    try:
        text = body["contents"][0]["parts"][0]["text"]
        voice = body["generationConfig"]["speechConfig"]["voiceConfig"][
            "prebuiltVoiceConfig"]["voiceName"]
    except (KeyError, IndexError, TypeError):
        raise ValueError("Petición TTS incompleta.") from None
    prefix = "Di en español: "
    if (not isinstance(text, str) or not text.startswith(prefix)
            or not isinstance(voice, str) or not voice):
        raise ValueError("Petición TTS incompleta.")
    return VoiceoverRequest(endpoint, model, body, text[len(prefix):], voice)


def _music(endpoint: str, body: dict,
           manifest: tuple[dict, ...]) -> MusicRequest:
    match = _LYRIA_ENDPOINT.fullmatch(endpoint)
    inputs = body.get('input')
    if (not match or not isinstance(inputs, list) or not inputs
            or not isinstance(inputs[0], dict)
            or set(inputs[0]) != {'type', 'text'}
            or inputs[0].get('type') != 'text'
            or not isinstance(inputs[0].get('text'), str)):
        raise ValueError('Petición Lyria incompleta.')
    project, prompt = match.group(1), inputs[0]['text']
    if not manifest:
        request = music_request(project, prompt)
    elif len(manifest) == 1:
        source = manifest[0]
        if set(source) != {
                'kind', 'role', 'ordinal', 'uri', 'mimeType', 'bytes',
                'sha256', 'generation'}:
            raise ValueError('Petición Lyria incompleta.')
        request = music_image_request(
            project, prompt, MusicGcsImageReference(
                source.get('uri'), source.get('mimeType'),
                source.get('bytes'), source.get('sha256'),
                source.get('generation')))
    else:
        raise ValueError('Petición Lyria incompleta.')
    if (request.endpoint != endpoint or request.body != body
            or request.input_manifest != manifest):
        raise ValueError('Petición Lyria incompleta.')
    return request


def _veo(endpoint: str, model: str, body: dict,
         manifest: tuple[dict, ...]) -> VideoRequest:
    """H2: reconstruye la petición Veo con SU constructor y compara el cuerpo.

    storageUri, MIME del sujeto, durationSeconds, resolución, sampleCount, aspectRatio
    y la location no quedan atados solo por la huella: se rederivan con el constructor
    canónico (veo_request o veo_subject_background_request, que rechazan WebP, modelos o
    locations no auditados, etc.) y el resultado debe casar EXACTAMENTE con el snapshot,
    como ya se hace con Lyria/TTS. Se prueban ambos constructores y se acepta el que
    reproduzca endpoint+cuerpo+manifiesto; si ninguno, se rechaza.
    """
    path = re.fullmatch(
        r"https://[^/]+/v1/projects/([a-z][a-z0-9-]{4,61}[a-z0-9])/locations/"
        r"([a-z0-9-]+)/publishers/google/models/([^:/]+):predictLongRunning",
        endpoint)
    if not path or path.group(3) != model:
        raise ValueError("Petición Veo incompleta.")
    project, location = path.group(1), path.group(2)
    instances, params = body.get("instances"), body.get("parameters")
    if (not isinstance(instances, list) or len(instances) != 1
            or not isinstance(instances[0], dict) or not isinstance(params, dict)):
        raise ValueError("Petición Veo incompleta.")
    inst = instances[0]
    prompt = inst.get("prompt")
    output_uri = params.get("storageUri")
    aspect = params.get("aspectRatio")
    duration = params.get("durationSeconds")   # §G: se rederiva igual que aspectRatio (16:9/9:16, 4/6/8)
    if (not isinstance(prompt, str)
            or (output_uri is not None and not isinstance(output_uri, str))):
        raise ValueError("Petición Veo incompleta.")
    subjects: list[VideoMedia] = []
    refs = inst.get("referenceImages")
    if refs is not None:
        if not isinstance(refs, list) or not refs:
            raise ValueError("Petición Veo incompleta.")
        for ref in refs:
            image = ref.get("image") if isinstance(ref, dict) else None
            data_b64 = image.get("bytesBase64Encoded") if isinstance(image, dict) else None
            mime = image.get("mimeType") if isinstance(image, dict) else None
            if not isinstance(data_b64, str) or not isinstance(mime, str):
                raise ValueError("Petición Veo incompleta.")
            try:
                data = b64decode(data_b64, validate=True)
            except (ValueError, TypeError):
                raise ValueError("Petición Veo incompleta.") from None
            subjects.append(VideoMedia("image", mime, data))
    builders = []
    image_field = inst.get("image")
    if image_field is not None:
        # §H: primer fotograma (image→video). Reconstruir SOLO desde el manifiesto (role first_frame),
        # con su constructor Veo 3.1 Fast; la comparación EXACTA de abajo es la garantía (H3).
        if not (len(manifest) == 1 and isinstance(manifest[0], dict)
                and manifest[0].get("role") == "first_frame"):
            raise ValueError("Petición Veo incompleta.")
        entry = manifest[0]
        try:
            frame = VeoFrameGcsReference(
                entry["uri"], entry["mimeType"], entry["bytes"],
                entry["sha256"], entry["generation"])
        except (KeyError, TypeError):
            raise ValueError("Petición Veo incompleta.") from None
        builders.append(lambda: veo_first_frame_request(
            project, model, prompt, frame, output_uri,
            aspect_ratio=aspect, duration_seconds=duration, location=location))
    else:
        if len(subjects) <= 1:
            builders.append(lambda: veo_request(
                project, model, prompt, subjects[0] if subjects else None,
                output_uri=output_uri, location=location,
                aspect_ratio=aspect, duration_seconds=duration))
        if 1 <= len(subjects) <= 3 and isinstance(output_uri, str) and isinstance(aspect, str):
            builders.append(lambda: veo_subject_background_request(
                project, model, prompt, tuple(subjects), output_uri,
                aspect_ratio=aspect))
    for build in builders:
        try:
            request = build()
        except ValueError:
            continue
        if (request.endpoint == endpoint and request.body == body
                and request.input_manifest == manifest):
            return request
    raise ValueError("Petición Veo incompleta.")


def _image_inline(project: str, model: str, parts: list, aspect_ratio: str) -> ImageRequest:
    # H3: imagen SIN referencias o con UNA referencia INLINE (texto primero, parts[1]
    # inlineData). Reconstruye con image_request. §G: el aspectRatio se rederiva del body (como en
    # multireference) para que un 16:9/9:16/… case; la comparación EXACTA en _image es la garantía.
    prompt = parts[0].get("text")
    if not isinstance(prompt, str):
        raise ValueError("Petición de imagen incompleta.")
    reference = None
    if len(parts) > 1:
        inline = parts[1].get("inlineData") if isinstance(parts[1], dict) else None
        data_b64 = inline.get("data") if isinstance(inline, dict) else None
        mime = inline.get("mimeType") if isinstance(inline, dict) else None
        if not isinstance(data_b64, str) or not isinstance(mime, str):
            raise ValueError("Petición de imagen incompleta.")
        try:
            data = b64decode(data_b64, validate=True)
        except (ValueError, TypeError):
            raise ValueError("Petición de imagen incompleta.") from None
        reference = ImageMedia(mime, data)
    try:
        return image_request(project, model, prompt, reference, aspect_ratio=aspect_ratio)
    except ValueError:
        raise ValueError("Petición de imagen incompleta.") from None


def _image_multireference(project: str, model: str, body: dict,
                          manifest: tuple[dict, ...], parts: list) -> ImageRequest:
    # Veredicto 20261022: imagen con 1-14 referencias GCS (parts fileData primero, {text} al
    # final). Reconstruye con image_reference_request desde el inputManifest (en su orden) y
    # el aspectRatio del body; la comparación EXACTA en _image es la garantía H3.
    last = parts[-1]
    prompt = last.get("text") if isinstance(last, dict) else None
    if not isinstance(prompt, str):
        raise ValueError("Petición de imagen incompleta.")
    config = body.get("generationConfig") if isinstance(body, dict) else None
    image_config = config.get("imageConfig") if isinstance(config, dict) else None
    aspect_ratio = (image_config.get("aspectRatio")
                    if isinstance(image_config, dict) else None)
    if not isinstance(aspect_ratio, str):
        raise ValueError("Petición de imagen incompleta.")
    references = []
    for entry in manifest:
        if not isinstance(entry, dict):
            raise ValueError("Petición de imagen incompleta.")
        try:
            references.append(ImageGcsReference(
                entry["uri"], entry["mimeType"], entry["bytes"],
                entry["sha256"], entry["generation"]))
        except (KeyError, TypeError):
            raise ValueError("Petición de imagen incompleta.") from None
    try:
        return image_reference_request(
            project, model, prompt, tuple(references), aspect_ratio=aspect_ratio)
    except ValueError:
        raise ValueError("Petición de imagen incompleta.") from None


def _image(endpoint: str, model: str, body: dict,
           manifest: tuple[dict, ...]) -> ImageRequest:
    """H3: reconstruye la imagen con su constructor y compara el cuerpo.

    Fija la resolución, el máximo de texto y la estructura canónicos; así un cuerpo
    con 2K/4K o varias candidatas no pasa aunque la huella case. Veredicto 20261022:
    distingue la imagen MULTI-REFERENCIA (parts con fileData) de la inline/sin-referencia y
    reconstruye con el constructor que corresponde; la garantía H3 (rebuild + comparación
    EXACTA body/endpoint/input_manifest) NO cambia: cualquier incoherencia parts↔manifest,
    2K/4K, varias candidatas o parts manipuladas siguen sin casar → rechazo fail-closed.
    """
    path = re.fullmatch(
        r"https://aiplatform\.googleapis\.com/v1/projects/"
        r"([a-z][a-z0-9-]{4,61}[a-z0-9])/locations/global/publishers/google/"
        r"models/([^:/]+):generateContent", endpoint)
    if not path or path.group(2) != model:
        raise ValueError("Petición de imagen incompleta.")
    project = path.group(1)
    contents = body.get("contents")
    parts = (contents[0].get("parts") if isinstance(contents, list)
             and len(contents) == 1 and isinstance(contents[0], dict) else None)
    if (not isinstance(parts, list) or not parts
            or not all(isinstance(part, dict) for part in parts)):
        raise ValueError("Petición de imagen incompleta.")
    if any("fileData" in part for part in parts):
        request = _image_multireference(project, model, body, manifest, parts)
    else:
        config = body.get("generationConfig") if isinstance(body, dict) else None
        image_config = config.get("imageConfig") if isinstance(config, dict) else None
        aspect_ratio = (image_config.get("aspectRatio")
                        if isinstance(image_config, dict) else None)
        if not isinstance(aspect_ratio, str):
            raise ValueError("Petición de imagen incompleta.")
        request = _image_inline(project, model, parts, aspect_ratio)
    if (request.endpoint != endpoint or request.body != body
            or request.input_manifest != manifest):
        raise ValueError("Petición de imagen incompleta.")
    return request


def google_request_from_snapshot(snapshot_json: str,
                                 expected_sha256: str):
    """Carga solo modelos conocidos y exige la misma huella ya aprobada."""
    if (not isinstance(snapshot_json, str)
            or not 1 <= len(snapshot_json.encode("utf-8")) <= _MAX_SNAPSHOT_BYTES
            or not isinstance(expected_sha256, str)
            or not _HASH.fullmatch(expected_sha256)):
        raise ValueError("Snapshot Google no válido.")
    try:
        value = json.loads(snapshot_json, parse_constant=_reject_constant)
    except (json.JSONDecodeError, UnicodeError, ValueError):
        raise ValueError("Snapshot Google no válido.") from None
    if (not isinstance(value, dict)
            or set(value) not in (
                {"endpoint", "model", "body", "inputManifest"},
                {"endpoint", "model", "body", "inputManifest", "quotaProject"})
            or not isinstance(value["endpoint"], str)
            or not isinstance(value["model"], str)
            or not isinstance(value["body"], dict)
            or not isinstance(value["inputManifest"], list)
            or any(not isinstance(item, dict) for item in value["inputManifest"])):
        raise ValueError("Snapshot Google no válido.")
    endpoint, model, body = value["endpoint"], value["model"], value["body"]
    manifest = tuple(value["inputManifest"])
    if model == CLOUD_TTS_MODEL:
        if (set(value) != {"endpoint", "model", "body", "inputManifest",
                           "quotaProject"}
                or endpoint != CLOUD_TTS_ENDPOINT or manifest
                or not isinstance(value["quotaProject"], str)):
            raise ValueError("Petición Cloud TTS incompleta.")
        try:
            script = body["input"]["text"]
            voice = body["voice"]["name"]
        except (KeyError, TypeError):
            raise ValueError("Petición Cloud TTS incompleta.") from None
        if not isinstance(script, str) or not isinstance(voice, str):
            raise ValueError("Petición Cloud TTS incompleta.")
        prefix = "es-ES-Chirp3-HD-"
        if not voice.startswith(prefix):
            raise ValueError("Petición Cloud TTS incompleta.")
        request = cloud_tts_request(
            value["quotaProject"], script, voice=voice[len(prefix):])
        if request.body != body:
            raise ValueError("Petición Cloud TTS incompleta.")
    elif set(value) != {"endpoint", "model", "body", "inputManifest"}:
        raise ValueError("Snapshot Google no válido.")
    elif model in IMAGE_MODELS:
        request = _image(endpoint, model, body, manifest)
    elif model in _VEO:
        request = _veo(endpoint, model, body, manifest)
    elif model == _OMNI:
        request = VideoRequest(
            endpoint, model, _video_mode(model, body, manifest), body, manifest)
    elif model == LYRIA_MODEL:
        request = _music(endpoint, body, manifest)
    elif model == TTS_MODEL:
        if manifest:
            raise ValueError("Petición TTS con manifiesto inesperado.")
        request = _voice(endpoint, model, body)
    else:
        raise ValueError("Modelo Google no admitido.")
    if fingerprint(request).sha256 != expected_sha256:
        raise ValueError("La petición Google cambió después de la aprobación.")
    return request

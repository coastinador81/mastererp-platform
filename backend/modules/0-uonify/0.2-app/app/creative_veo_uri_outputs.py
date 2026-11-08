"""Normaliza URI GCS de una operación Veo terminada y exacta."""

import re
from urllib.parse import urlsplit

from .creative_video_contracts import VideoUriOutput, operation_name_matches


def _prefix(value: str):
    parsed = urlsplit(value) if isinstance(value, str) else None
    segments = parsed.path.strip("/").split("/") if parsed else []
    if (not parsed or not 1 <= len(value) <= 2048
            or parsed.scheme != "gs" or not parsed.netloc
            or not re.fullmatch(
                r"[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]", parsed.netloc)
            or parsed.query or parsed.fragment
            or "%" in parsed.path or not parsed.path.endswith("/")
            or not segments
            or any(not item or item in (".", "..") for item in segments)):
        raise ValueError("Prefijo GCS de Veo no válido.")
    return parsed


def veo_completed_uris(
        response: dict, operation_name: str,
        expected_prefix: str) -> tuple[VideoUriOutput, ...]:
    """Acepta solo vídeos bajo el prefijo GCS reservado al despachar."""
    prefix = _prefix(expected_prefix)
    if (not isinstance(response, dict)
            or not operation_name_matches(response.get("name"), operation_name)
            or response.get("done") is not True or response.get("error")):
        raise ValueError("La operación Veo no terminó correctamente.")
    result = response.get("response")
    videos = result.get("videos") if isinstance(result, dict) else None
    usage = result.get("usage") if isinstance(result, dict) else None
    if (not isinstance(videos, list) or len(videos) != 1
            or (usage is not None and not isinstance(usage, dict))):
        raise ValueError("Veo no devolvió vídeos GCS utilizables.")
    outputs, seen = [], set()
    for item in videos:
        if (not isinstance(item, dict)
                or item.get("mimeType") != "video/mp4"):
            raise ValueError("Formato GCS de Veo no admitido.")
        uri = item.get("gcsUri")
        parsed = urlsplit(uri) if isinstance(uri, str) else None
        relative = (parsed.path[len(prefix.path):]
                    if parsed and parsed.path.startswith(prefix.path) else "")
        relative_parts = relative.split("/")
        if (not parsed or not 1 <= len(uri) <= 2048
                or parsed.scheme != "gs"
                or parsed.netloc != prefix.netloc
                or parsed.query or parsed.fragment or "%" in parsed.path
                or not relative
                or not 1 <= len(relative_parts) <= 16
                or any(value in ("", ".", "..")
                       for value in relative_parts)
                or uri in seen):
            raise ValueError("La salida Veo no pertenece al prefijo autorizado.")
        seen.add(uri)
        outputs.append(VideoUriOutput("video/mp4", uri, usage))
    return tuple(outputs)

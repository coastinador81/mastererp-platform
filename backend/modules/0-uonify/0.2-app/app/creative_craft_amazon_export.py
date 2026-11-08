"""Presets de exportación a Amazon para el montaje Craft (offline, INACTIVO).

Define los preajustes de exportación de Amazon (ficha de producto y anuncio
Sponsored), construye la ESPECIFICACIÓN del comando ffmpeg para cada export y valida
una salida MP4 contra su preset con un oráculo medible en Python puro sobre las cajas
ISO BMFF (duración, resolución, aspecto, fps, fourcc de vídeo/audio, presencia o
ausencia de pista de audio y tamaño).

IMPORTANTE — el render NO se ejecuta aquí.  ``plan_amazon_export`` devuelve el
``ffmpeg_argv`` como una *especificación* (``render_status =
'pending_audited_sandbox_codec'``): este módulo no invoca ffmpeg, códecs ni
subprocesos, coherente con ``creative_media_inspection`` (que levanta
``DecoderUnavailable`` para MP4 por diseño).  Incorporar un códec real para renderizar
es una decisión de infraestructura y seguridad aparte.  Aquí solo se planifica (nombre
determinista, reanudable sin duplicar) y se VALIDA una salida ya producida.

El texto y los logotipos se añaden en el montaje de Uonify, nunca en este export ni en
el generador.  Un pedido «sin audio» (``drop_audio=True``) exige que la salida NO tenga
pista de audio; en caso contrario se exige pista de audio AAC.
"""

from __future__ import annotations

from dataclasses import dataclass
from math import gcd
import re

from .creative_video_contracts import (
    _boxes, mp4_duration_seconds, mp4_video_geometry,
)


_HEX64 = re.compile(r"[0-9a-f]{64}\Z")
_DURATION_TOLERANCE = 0.1
RENDER_PENDING = "pending_audited_sandbox_codec"


class AmazonExportError(ValueError):
    """Base de los errores de exportación Amazon (fail-closed)."""


class UnknownAmazonExportPreset(AmazonExportError):
    """El preset de exportación Amazon solicitado no existe."""


class AmazonExportValidationError(AmazonExportError):
    """La salida MP4 no cumple el preset de Amazon exacto. Fail-closed."""


class AmazonExportRenderPending(AmazonExportError):
    """No hay salida renderizada y el render real necesita un códec auditado."""


@dataclass(frozen=True)
class AmazonExportPreset:
    key: str
    label: str
    aspects: tuple[str, ...]
    max_long_edge: int
    max_short_edge: int
    exact_dimensions: tuple[tuple[int, int], ...] | None
    duration_max_seconds: float | None
    duration_exact_seconds: float | None
    max_fps: float
    video_fourcc: bytes
    audio_fourcc: bytes
    max_bytes: int
    min_overall_bitrate_bps: int | None
    recommended_bitrate_bps: int | None


@dataclass(frozen=True)
class AmazonExportReceipt:
    preset: str
    duration_seconds: float
    width: int
    height: int
    frame_rate: float
    aspect: str
    video_codec: str
    has_audio: bool
    audio_codec: str | None
    byte_size: int
    overall_bitrate_bps: float


@dataclass(frozen=True)
class AmazonExportPlan:
    preset: str
    output_name: str
    ffmpeg_argv: tuple[str, ...]
    expect_audio: bool
    source_sha256: str
    render_status: str = RENDER_PENDING


# Decisiones del dueño (26-09-2026), vía Interfaz:
#  - vídeo de ficha de Amazon: <=30 s, <=1080p, 16:9 o 9:16;
#  - anuncio de Amazon (Sponsored Brands/display): 15 s, 16:9, 1920x1080.
# Límites de tamaño y bitrate DOCUMENTADOS en docs/frontend/reference/video-research.json:
#  - ficha: tamaño <=5 GB (5e9, el valor seguro); bitrate NO publicado por Amazon.
#  - anuncio (Sponsored Brands): tamaño <=500 MB; bitrate de vídeo mínimo 1 Mbps
#    (4 Mbps+ recomendado).
# El bitrate validado aquí es el GLOBAL del contenedor (bytes*8/duración), un proxy
# (necesario, no suficiente) del bitrate de la pista de vídeo: offline no se demultiplexa.
LISTING_VIDEO = AmazonExportPreset(
    key="amazon_listing_video", label="Vídeo de ficha de Amazon",
    aspects=("16:9", "9:16"), max_long_edge=1920, max_short_edge=1080,
    exact_dimensions=None, duration_max_seconds=30.0,
    duration_exact_seconds=None, max_fps=60.0, video_fourcc=b"avc1",
    audio_fourcc=b"mp4a", max_bytes=5_000_000_000,
    min_overall_bitrate_bps=None, recommended_bitrate_bps=None)

SPONSORED_AD = AmazonExportPreset(
    key="amazon_sponsored_ad", label="Anuncio de Amazon (Sponsored)",
    aspects=("16:9",), max_long_edge=1920, max_short_edge=1080,
    exact_dimensions=((1920, 1080),), duration_max_seconds=None,
    duration_exact_seconds=15.0, max_fps=60.0, video_fourcc=b"avc1",
    audio_fourcc=b"mp4a", max_bytes=500_000_000,
    min_overall_bitrate_bps=1_000_000, recommended_bitrate_bps=4_000_000)

AMAZON_EXPORT_PRESETS = {p.key: p for p in (LISTING_VIDEO, SPONSORED_AD)}


def _preset(preset_key: str) -> AmazonExportPreset:
    preset = AMAZON_EXPORT_PRESETS.get(preset_key)
    if preset is None:
        raise UnknownAmazonExportPreset(f"Preset Amazon desconocido: {preset_key!r}.")
    return preset


def _aspect(width: int, height: int) -> str:
    if width <= 0 or height <= 0:
        raise AmazonExportValidationError("Geometría de vídeo no válida.")
    if width * 9 == height * 16:
        return "16:9"
    if width * 16 == height * 9:
        return "9:16"
    divisor = gcd(width, height)
    return f"{width // divisor}:{height // divisor}"


def _stsd_fourcc(data: bytes, minf_box: tuple) -> bytes:
    _, start, end = minf_box
    stbl = [box for box in _boxes(data, start, end) if box[0] == b"stbl"]
    if len(stbl) != 1:
        raise AmazonExportValidationError("Pista MP4 sin tabla de muestras única.")
    _, stbl_start, stbl_end = stbl[0]
    stsd = [box for box in _boxes(data, stbl_start, stbl_end) if box[0] == b"stsd"]
    if len(stsd) != 1:
        raise AmazonExportValidationError("Pista MP4 sin descripción de muestra.")
    _, payload_start, payload_end = stsd[0]
    if payload_start + 16 > payload_end:
        raise AmazonExportValidationError("Descripción de muestra MP4 incompleta.")
    entry_count = int.from_bytes(data[payload_start + 4:payload_start + 8], "big")
    if entry_count < 1:
        raise AmazonExportValidationError("Descripción de muestra MP4 vacía.")
    return data[payload_start + 12:payload_start + 16]


def _track_codecs(data: bytes) -> tuple[bytes, bytes | None]:
    """Devuelve (fourcc de vídeo, fourcc de audio o None) desde las cajas MP4."""
    top = list(_boxes(data, 0, len(data)))
    moovs = [box for box in top if box[0] == b"moov"]
    if len(moovs) != 1:
        raise AmazonExportValidationError("MP4 sin índice único.")
    _, moov_start, moov_end = moovs[0]
    video_fourcc: bytes | None = None
    audio_fourccs: list[bytes] = []
    for kind, track_start, track_end in _boxes(data, moov_start, moov_end):
        if kind != b"trak":
            continue
        track_boxes = list(_boxes(data, track_start, track_end))
        mdia = [box for box in track_boxes if box[0] == b"mdia"]
        if len(mdia) != 1:
            continue
        _, mdia_start, mdia_end = mdia[0]
        media_boxes = list(_boxes(data, mdia_start, mdia_end))
        hdlr = [box for box in media_boxes if box[0] == b"hdlr"]
        minf = [box for box in media_boxes if box[0] == b"minf"]
        if len(hdlr) != 1 or len(minf) != 1:
            continue
        _, handler_start, handler_end = hdlr[0]
        if handler_start + 12 > handler_end:
            continue
        handler = data[handler_start + 8:handler_start + 12]
        if handler == b"vide":
            if video_fourcc is not None:
                raise AmazonExportValidationError("MP4 con más de una pista de vídeo.")
            video_fourcc = _stsd_fourcc(data, minf[0])
        elif handler == b"soun":
            audio_fourccs.append(_stsd_fourcc(data, minf[0]))
    if video_fourcc is None:
        raise AmazonExportValidationError("MP4 sin pista de vídeo.")
    if len(audio_fourccs) > 1:
        raise AmazonExportValidationError("MP4 con más de una pista de audio.")
    return video_fourcc, (audio_fourccs[0] if audio_fourccs else None)


def validate_amazon_export(output_bytes: bytes, preset_key: str, *,
                           expect_audio: bool) -> AmazonExportReceipt:
    """Valida una salida MP4 contra su preset de Amazon. Fail-closed."""
    preset = _preset(preset_key)
    if not isinstance(output_bytes, (bytes, bytearray)) or not output_bytes:
        raise AmazonExportValidationError("La salida de exportación está vacía.")
    data = bytes(output_bytes)
    size = len(data)
    if size > preset.max_bytes:
        raise AmazonExportValidationError("La salida supera el tamaño del preset.")
    try:
        duration = mp4_duration_seconds(data)
        width, height, frame_rate = mp4_video_geometry(data)
    except ValueError as error:
        raise AmazonExportValidationError(
            "La salida no es un MP4 medible.") from error
    overall_bitrate = (size * 8) / duration if duration > 0 else 0.0
    if (preset.min_overall_bitrate_bps is not None
            and overall_bitrate < preset.min_overall_bitrate_bps):
        raise AmazonExportValidationError(
            "El bitrate global es inferior al mínimo del preset.")
    video_fourcc, audio_fourcc = _track_codecs(data)
    if (preset.duration_exact_seconds is not None
            and abs(duration - preset.duration_exact_seconds) > _DURATION_TOLERANCE):
        raise AmazonExportValidationError("La duración no coincide con el preset.")
    if (preset.duration_max_seconds is not None
            and duration > preset.duration_max_seconds + _DURATION_TOLERANCE):
        raise AmazonExportValidationError("La duración supera el máximo del preset.")
    if preset.exact_dimensions is not None:
        if (width, height) not in preset.exact_dimensions:
            raise AmazonExportValidationError("La resolución no coincide con el preset.")
    else:
        long_edge, short_edge = max(width, height), min(width, height)
        if long_edge > preset.max_long_edge or short_edge > preset.max_short_edge:
            raise AmazonExportValidationError("La resolución supera el máximo del preset.")
    aspect = _aspect(width, height)
    if aspect not in preset.aspects:
        raise AmazonExportValidationError("La relación de aspecto no es del preset.")
    if not 0 < frame_rate <= preset.max_fps:
        raise AmazonExportValidationError("La cadencia no es válida para el preset.")
    if video_fourcc != preset.video_fourcc:
        raise AmazonExportValidationError("El códec de vídeo no es el del preset.")
    has_audio = audio_fourcc is not None
    if has_audio != expect_audio:
        raise AmazonExportValidationError(
            "La presencia de audio no coincide con lo solicitado.")
    if has_audio and audio_fourcc != preset.audio_fourcc:
        raise AmazonExportValidationError("El códec de audio no es el del preset.")
    return AmazonExportReceipt(
        preset.key, duration, width, height, frame_rate, aspect,
        video_fourcc.decode("ascii"), has_audio,
        audio_fourcc.decode("ascii") if audio_fourcc else None, size,
        overall_bitrate)


def amazon_export_output_name(preset_key: str, source_sha256: str, *,
                              drop_audio: bool) -> str:
    """Nombre de salida DETERMINISTA (misma entrada -> mismo nombre)."""
    preset = _preset(preset_key)
    if not isinstance(source_sha256, str) or not _HEX64.fullmatch(source_sha256):
        raise AmazonExportError("source_sha256 no es un SHA-256.")
    suffix = "-noaudio" if drop_audio else ""
    return f"exports/amazon/{preset.key}/{source_sha256}{suffix}.mp4"


def _ffmpeg_argv(preset: AmazonExportPreset, output_name: str,
                 drop_audio: bool) -> tuple[str, ...]:
    """ESPECIFICACIÓN del comando (NO se ejecuta). Render pendiente de códec."""
    if preset.exact_dimensions is not None:
        width, height = preset.exact_dimensions[0]
        video_filter = (f"scale={width}:{height}:force_original_aspect_ratio="
                        f"decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,setsar=1")
    else:
        video_filter = (f"scale='min(iw,{preset.max_long_edge})':"
                        f"'min(ih,{preset.max_short_edge})':"
                        "force_original_aspect_ratio=decrease,setsar=1")
    limit = preset.duration_exact_seconds or preset.duration_max_seconds
    argv = ["ffmpeg", "-nostdin", "-n", "-i", "<source-media>",
            "-t", f"{limit:g}", "-vf", video_filter,
            "-c:v", "libx264", "-pix_fmt", "yuv420p"]
    argv += ["-an"] if drop_audio else ["-c:a", "aac", "-b:a", "128k"]
    argv += [output_name]
    return tuple(argv)


def plan_amazon_export(preset_key: str, *, source_sha256: str,
                       drop_audio: bool = False) -> AmazonExportPlan:
    """Planifica un export Amazon: nombre determinista + spec ffmpeg (no ejecutada)."""
    preset = _preset(preset_key)
    output_name = amazon_export_output_name(
        preset.key, source_sha256, drop_audio=drop_audio)
    return AmazonExportPlan(
        preset=preset.key, output_name=output_name,
        ffmpeg_argv=_ffmpeg_argv(preset, output_name, drop_audio),
        expect_audio=not drop_audio, source_sha256=source_sha256,
        render_status=RENDER_PENDING)


def finalize_amazon_export(plan: AmazonExportPlan, store) -> AmazonExportReceipt:
    """Reanuda sin duplicar: valida la salida ya presente en ``store``.

    ``store`` es un mapa create-only {nombre -> bytes} de salidas ya renderizadas.
    Si la salida del plan ya existe, se VALIDA y se devuelve su recibo (idempotente,
    no se vuelve a crear ni se duplica).  Si no existe, falla cerrado con
    ``AmazonExportRenderPending`` (el render real necesita un códec auditado); nunca
    fabrica ni duplica una salida.
    """
    if not isinstance(plan, AmazonExportPlan):
        raise AmazonExportError("Plan de exportación no válido.")
    existing = store.get(plan.output_name)
    if existing is None:
        raise AmazonExportRenderPending(
            "No hay salida renderizada; el render real necesita un códec auditado "
            "en sandbox (no disponible).")
    return validate_amazon_export(
        existing, plan.preset, expect_audio=plan.expect_audio)

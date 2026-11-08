"""Catálogo Google comprobado para selección; nunca concede ejecución por sí solo."""

from dataclasses import asdict, dataclass
from enum import Enum
from hashlib import sha256
import json
import re


AUDITED_PROJECT = "uonify-757ec8c3ab3245ffa45d"
AUDIT_RESULTS_SHA256 = (
    "d3c38ecb7bba07367ee54f812f19fda072a49375add3fb0ce6395ea642561ed2")
REFERENCE_RESULTS_SHA256 = (
    "aaef3981b3f1c2bf23e93c05751946235614734e9a191212c63f71149965b5ce")
SERVICE_CHECKS_SHA256 = (
    "856eca2337f8f13b0aa69454ea6ef9a417a17d4dba59538c337207a9aaff3ce6")
VERIFIED_AT = "2026-10-18"
_HASH = re.compile(r"[0-9a-f]{64}\Z")


@dataclass(frozen=True)
class GoogleCreativeCapability:
    model: str
    label: str
    service: str
    location: str
    launch_stage: str
    verified_modes: tuple[str, ...]
    contract_only_modes: tuple[str, ...]
    input_modalities: tuple[str, ...]
    output_modality: str
    recovery: str
    maximum_cost_ready: bool


@dataclass(frozen=True)
class GoogleCreativeCatalog:
    schema_version: int
    project: str
    verified_at: str
    availability: str
    requires_live_preflight: bool
    execution_enabled: bool
    capabilities: tuple[GoogleCreativeCapability, ...]
    enabled_services: tuple[str, ...]
    audit_results_sha256: str
    reference_results_sha256: str
    service_checks_sha256: str
    catalog_sha256: str


# 12a / H8 (pin de versiones de modelo, veredicto del Consultor 2026-10-22): este catálogo
# es la FUENTE ÚNICA de los IDs de modelo; los demás módulos Google derivan de aquí en vez
# de re-listarlos. Los IDs son los EXACTOS de Vertex y NO se migran a IDs de la Gemini API:
# Veo es Vertex (service="vertex_ai"); Omni es Gemini API (service=
# "gemini_enterprise_agent_platform"); NUNCA se mezclan. Veo 3.1 (veo-3.1-generate-001 /
# veo-3.1-fast-generate-001) se retira «Nov 17, 2026 or later»: vigilar las model-versions
# de Vertex antes de esa fecha y, al sustituir, cambiar SOLO aquí (plan de sustitución). El
# guard de test fija estas invariantes para que un cambio no migre Veo a la Gemini API.
_CAPABILITIES = (
    GoogleCreativeCapability(
        "gemini-nano-banana-2.1", "Nano Banana 2.1", "vertex_ai", "global",
        "ga", ("text_to_image",), ("reference_images_edit_1_to_14",),
        ("text", "image"), "image", "synchronous", True),
    GoogleCreativeCapability(
        "gemini-3.1-flash-image", "Gemini 3.1 Flash Image", "vertex_ai",
        "global", "ga", ("text_to_image",),
        ("reference_images_edit_1_to_14",),
        ("text", "image"), "image", "synchronous", True),
    GoogleCreativeCapability(
        "gemini-3-pro-image", "Gemini 3 Pro Image", "vertex_ai", "global",
        "ga", ("text_to_image",), ("reference_images_edit_1_to_14",),
        ("text", "image"), "image", "synchronous", True),
    GoogleCreativeCapability(
        "veo-3.1-fast-generate-001", "Veo 3.1 Fast", "vertex_ai",
        "us-central1", "ga", ("text_to_video", "reference_image_to_video"),
        ("durable_subject_references_1_to_3",),
        ("text", "image"), "video", "long_running_operation", True),
    GoogleCreativeCapability(
        "veo-3.1-generate-001", "Veo 3.1", "vertex_ai", "us-central1",
        "ga", ("text_to_video",), ("durable_subject_references_1_to_3",),
        ("text", "image"), "video",
        "long_running_operation", True),
    GoogleCreativeCapability(
        "gemini-omni-1.1-flash-preview", "Gemini Omni 1.1 Flash",
        "gemini_enterprise_agent_platform", "global", "preview",
        # Reconciliación 22-10 (Consultor): la entrega REAL de vídeo de Omni está [NO VERIFICADA]
        # (auditoría 18-10 vio ~3 s/360p, por debajo del spec documentado) → sus 4 modos de vídeo
        # pasan de verified a contract_only. Una prueba real podría subir modos concretos más adelante.
        (),
        ("text_to_video", "reference_image_to_video",
         "reference_image_video_to_video", "edit_video",
         "background_text_to_video", "durable_references_1_to_13",
         "durable_first_last_frames", "durable_edit_video"),
        ("text", "image", "video"),
        "video", "stored_interaction_for_background_only", True),
    GoogleCreativeCapability(
        "gemini-2.5-flash-tts", "Gemini 2.5 Flash TTS", "vertex_ai",
        "europe-southwest1", "documented", ("text_to_speech_es",), (), ("text",),
        "audio_pcm", "synchronous", True),
    GoogleCreativeCapability(
        "chirp-3-hd", "Cloud TTS Chirp 3 HD", "cloud_text_to_speech",
        "global", "ga", ("text_to_speech_es",), (), ("text",),
        "audio_mp3", "synchronous", True),
    GoogleCreativeCapability(
        "lyria-3-clip-preview", "Lyria 3 Clip", "gemini_enterprise_agent_platform",
        "global", "preview", ("text_to_music_30s",),
        ("image_to_music_30s",), ("text", "image"),
        "audio_mp3", "synchronous_no_provider_recovery", True),
)


def model_ids(*, service: str, output_modality: str) -> frozenset:
    """H8: IDs derivados de la FUENTE ÚNICA (este catálogo) por servicio y modalidad; los
    demás módulos Google los obtienen de aquí en vez de re-listarlos."""
    return frozenset(item.model for item in _CAPABILITIES
                     if item.service == service
                     and item.output_modality == output_modality)


def veo_model_ids() -> frozenset:
    """IDs de Veo (Vertex, vídeo). Excluye Omni (Gemini API), que no se mezcla con Veo."""
    return model_ids(service="vertex_ai", output_modality="video")


def image_model_ids() -> frozenset:
    """IDs de imagen de Vertex."""
    return model_ids(service="vertex_ai", output_modality="image")


class ModelId(str, Enum):
    """H8-amplio (forma verdictada por el Consultor, 20261022-VEREDICTO-H8-AMPLIO-IDS-MODELO.md):
    IDs de modelo NOMBRADOS. El literal del id vive SOLO aquí y en _CAPABILITIES (la biyección del
    guard los ata; «fuente única» = fichero único); los demás módulos importan ModelId y keyean por
    ModelId.X en vez de re-listar literales. Al ser str-Enum, ModelId.X == el id crudo y comparte
    hash, así que sirve de clave de dict y matchea request.model indistintamente. Auto-recolector:
    el guard exige la biyección con _CAPABILITIES, sin lista paralela que mantener."""
    NANO_BANANA_21 = "gemini-nano-banana-2.1"
    FLASH_IMAGE = "gemini-3.1-flash-image"
    PRO_IMAGE = "gemini-3-pro-image"
    VEO_31_FAST = "veo-3.1-fast-generate-001"
    VEO_31 = "veo-3.1-generate-001"
    OMNI_11 = "gemini-omni-1.1-flash-preview"
    FLASH_TTS = "gemini-2.5-flash-tts"
    CHIRP_3_HD = "chirp-3-hd"
    LYRIA_3 = "lyria-3-clip-preview"


def omni_model_ids() -> frozenset:
    """IDs de Omni (Gemini API, vídeo). Simétrico de veo_model_ids; Omni no se mezcla con Veo."""
    return model_ids(service="gemini_enterprise_agent_platform", output_modality="video")


def models_with_verified_mode(mode: str) -> frozenset:
    """H8: IDs cuyos verified_modes incluyen `mode` (fuente única; «lo verificado manda»). Los
    contract_only NO cuentan como verificados. OJO: puede cruzar servicios — p.ej.
    reference_image_to_video está en Veo 3.1 Fast Y en Omni; si quieres solo Veo, interseca con
    veo_model_ids(). (La entrega real de vídeo de Omni está [NO VERIFICADA]; ver flag de catálogo.)"""
    return frozenset(item.model for item in _CAPABILITIES if mode in item.verified_modes)


def ga_models_with_verified_mode(mode: str) -> frozenset:
    """B1 (hallazgo ROJO de REA + bandera del Consultor): como `models_with_verified_mode` pero
    SOLO modelos en GA (`launch_stage == 'ga'`). El enrutado de CLIPS COMERCIALES debe usar esta
    variante para que un modelo Preview (p. ej. Omni) NUNCA sea elegible, aunque algún modo suyo
    pasara de contract_only a verified. Lee `launch_stage` del catálogo (fuente única); ningún id
    se cablea a mano aguas arriba."""
    return frozenset(item.model for item in _CAPABILITIES
                     if mode in item.verified_modes and item.launch_stage == 'ga')


def model_label(model: str):
    """El nombre de Google que SÍ se muestra al cliente en pequeño (p. ej. «Veo 3.1 Fast»), derivado
    del catálogo. Evita exponer el id de modelo CRUDO (veo-3.1-fast-generate-001) al navegador o al
    modelo (D-PROTECCION-INGENIERIA-INVERSA): la tarjeta muestra la etiqueta, no el id. None si el
    modelo no está en el catálogo."""
    for item in _CAPABILITIES:
        if item.model == model:
            return item.label
    return None


def model_location(model: str):
    """H5: la location PINADA del modelo en el catálogo (residencia). Veo=us-central1, imagen/Lyria/
    Omni=global, TTS=europe-southwest1. El host esperado se deriva de aquí, no es parámetro libre.
    None si el modelo no está en el catálogo (→ rechazo fail-closed por quien lo consulte)."""
    for item in _CAPABILITIES:
        if item.model == model:
            return item.location
    return None


def model_launch_stage(model: str):
    """El estado de lanzamiento PINADO del modelo en el catálogo ('ga', 'preview', 'documented',
    'legacy'). Lo consume el registro de motores (oferta variable, dictamen 27-10 §C) para saber si
    un candidato es GA o Preview SIN re-listar literales: la GA-idad la manda el catálogo (fuente
    única H8), no la config del registro. Simétrico de `model_label`/`model_location`. None si el
    modelo no está en el catálogo (→ rechazo fail-closed por quien lo consulte)."""
    for item in _CAPABILITIES:
        if item.model == model:
            return item.launch_stage
    return None


def _catalog_hash(payload: dict) -> str:
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True,
                     separators=(",", ":"), allow_nan=False)
    return sha256(raw.encode("utf-8")).hexdigest()


def google_creative_catalog(
        project: str, *, audit_results_sha256: str,
        reference_results_sha256: str,
        service_checks_sha256: str) -> GoogleCreativeCatalog:
    """Devuelve lo observado, manteniendo un preflight vivo como requisito."""
    evidence = (audit_results_sha256, reference_results_sha256,
                service_checks_sha256)
    if (project != AUDITED_PROJECT or any(not isinstance(value, str)
                                           or not _HASH.fullmatch(value)
                                           for value in evidence)
            or evidence != (AUDIT_RESULTS_SHA256, REFERENCE_RESULTS_SHA256,
                            SERVICE_CHECKS_SHA256)):
        raise ValueError("La evidencia de capacidades Google no corresponde al proyecto.")
    enabled = ("storage.googleapis.com", "texttospeech.googleapis.com",
               "transcoder.googleapis.com")
    payload = {
        "schemaVersion": 1,
        "project": project,
        "verifiedAt": VERIFIED_AT,
        "availability": "historically_verified",
        "requiresLivePreflight": True,
        "executionEnabled": False,
        "capabilities": [asdict(item) for item in _CAPABILITIES],
        "enabledServices": enabled,
        "evidence": evidence,
    }
    return GoogleCreativeCatalog(
        1, project, VERIFIED_AT, "historically_verified", True, False,
        _CAPABILITIES, enabled, *evidence, _catalog_hash(payload))

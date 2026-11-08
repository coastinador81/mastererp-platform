"""Segmento de turno tipado `estudioCard` + acción `estudioAction` del Estudio en el chat (costura
con Frontend-app, FEA-02). PLOMERÍA DE SERVIDOR INVISIBLE: contrato de datos CARD-SAFE de las 5
tarjetas (plan/creating/result/images/publish) que VIAJA con el turno del asistente, como
`productProposal`. El diseño VISUAL de las tarjetas es de Frontend-app + aprobación del dueño
(D-UX-OWNER-DEFINES); aquí SOLO el contrato de datos y su validación.

ACTIVACIÓN GATED: `estudio_card_or_none(card)` devuelve la tarjeta validada solo si hay dato REAL;
con `None` (sin estado real del Estudio en el turno) NO se pinta nada → sin éxito simulado. El
cableado de la emisión en el turno (uony_routes / queue.response) se añade al ACTIVAR el dispatch
(lote gated, con interfaz); este módulo es INERTE hasta entonces.

CARD-SAFE (D-PROTECCION-INGENIERIA-INVERSA): nunca USD, ids internos de modelo, hashes, `gs://` ni
project-id. El precio va como `maxEur` (string en €) o None; el motor como `engineLabel` (p. ej.
«Google Veo 3.1 Fast»), nunca el id crudo; las urls son https (firmadas / Drive), nunca `gs://`.
Fail-closed: cualquier fuga o forma inválida es `EstudioCardError`."""
from __future__ import annotations

import re
from dataclasses import dataclass

_KINDS = ("plan", "creating", "result", "images", "publish")
_ACTIONS = ("crear", "cambiar", "publicar", "cancelar", "cambiar_escena")
_ITEM_STATES = ("enCola", "creandose", "lista", "fallida", "incierta")
_TAG_TYPES = ("persona", "producto", "lugar", "estilo")

_UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\Z")
_HEX64 = re.compile(r"(?<![0-9a-f])[0-9a-f]{64}(?![0-9a-f])")
_USD = re.compile(r"\$\s?\d|\bUSD\b|\bus\$\b", re.IGNORECASE)
_PROJECT = re.compile(r"\bprojects/|\bproject[_-]?id\b", re.IGNORECASE)
# Ids de modelo CRUDOS (D-PROTECCION: mostrar el label, no el id). El patrón exige guion+dígito en
# los nombres que también son palabras («veo», «imagen») → el label «Veo 3.1 Fast» pasa, «veo-3.1» no.
_RAW_MODEL = re.compile(
    r"(?i)\b(?:(?:veo|imagen)-\d|(?:gemini|omni|lyria)-|nano-banana-)")
# Huellas del método/skill que no deben salir al cliente.
_FINGERPRINT = re.compile(r"(?i)\b(?:skill_version|source_sha256)\b")


class EstudioCardError(Exception):
    """Fail-closed: la tarjeta del Estudio no es card-safe o su forma es inválida."""


def _assert_card_safe_string(value: str, label: str) -> None:
    if "gs://" in value:
        raise EstudioCardError(f"{label}: una ruta gs:// no puede salir al cliente.")
    if _HEX64.search(value):
        raise EstudioCardError(f"{label}: un hash no puede salir al cliente.")
    if _USD.search(value):
        raise EstudioCardError(f"{label}: el importe en USD no puede salir al cliente.")
    if _PROJECT.search(value):
        raise EstudioCardError(f"{label}: el project-id no puede salir al cliente.")
    if _RAW_MODEL.search(value):
        raise EstudioCardError(f"{label}: un id de modelo crudo no puede salir (usa el label).")
    if _FINGERPRINT.search(value):
        raise EstudioCardError(f"{label}: una huella de método no puede salir al cliente.")


def _assert_card_safe(obj: object, label: str = "card") -> None:
    if isinstance(obj, str):
        _assert_card_safe_string(obj, label)
    elif isinstance(obj, dict):
        for key, value in obj.items():
            _assert_card_safe(value, f"{label}.{key}")
    elif isinstance(obj, (list, tuple)):
        for index, value in enumerate(obj):
            _assert_card_safe(value, f"{label}[{index}]")


def _url_ok(value: object, label: str) -> None:
    if value is None:
        return
    if not isinstance(value, str) or not value.startswith("https://"):
        raise EstudioCardError(f"{label}: la url debe ser https (firmada o de Drive).")


def validate_estudio_card(card: dict) -> dict:
    """Valida la forma + card-safe del `estudioCard`. Devuelve la tarjeta o lanza EstudioCardError."""
    if not isinstance(card, dict):
        raise EstudioCardError("La tarjeta no es un objeto.")
    kind = card.get("kind")
    if kind not in _KINDS:
        raise EstudioCardError("kind de tarjeta no reconocido.")
    if not isinstance(card.get("threadId"), str) or not _UUID.fullmatch(card["threadId"]):
        raise EstudioCardError("threadId no es un uuid.")
    if not isinstance(card.get("title"), str) or not card["title"].strip():
        raise EstudioCardError("La tarjeta necesita un título.")
    if "quoteId" in card and card["quoteId"] is not None:
        if not isinstance(card["quoteId"], str) or not _UUID.fullmatch(card["quoteId"]):
            raise EstudioCardError("quoteId no es un uuid.")
    if "version" in card and card["version"] is not None and type(card["version"]) is not int:
        raise EstudioCardError("version no es entero.")
    if ("payer" in card and card["payer"] is not None
            and card["payer"] != "customer_google_project"):
        raise EstudioCardError("payer no reconocido.")
    _url_ok(card.get("downloadUrl"), "downloadUrl")

    if "maxEur" in card and card["maxEur"] is not None:
        if not isinstance(card["maxEur"], str) or "$" in card["maxEur"]:
            raise EstudioCardError("maxEur debe ser un string en € (nunca USD).")

    if kind in ("creating", "result"):
        items = card.get("items")
        if not isinstance(items, list) or not items:
            raise EstudioCardError("creating/result necesitan items por escena.")
        for item in items:
            if (not isinstance(item, dict) or type(item.get("index")) is not int
                    or not isinstance(item.get("title"), str)
                    or item.get("state") not in _ITEM_STATES):
                raise EstudioCardError("Un item de escena es inválido.")
            for url_key in ("posterUrl", "playUrl"):
                _url_ok(item.get(url_key), f"items.{url_key}")
        progress = card.get("progress")
        if progress is not None and (not isinstance(progress, dict)
                or type(progress.get("current")) is not int
                or type(progress.get("total")) is not int):
            raise EstudioCardError("progress es inválido.")

    if kind == "images":
        images = card.get("images")
        if not isinstance(images, list) or not images:
            raise EstudioCardError("images necesita la lista de imágenes.")
        for image in images:
            if (not isinstance(image, dict) or not isinstance(image.get("id"), str)
                    or not isinstance(image.get("label"), str)):
                raise EstudioCardError("Una imagen es inválida.")
            for url_key in ("url", "previewUrl"):
                _url_ok(image.get(url_key), f"images.{url_key}")

    if kind == "plan":
        scenes = card.get("scenes")
        if scenes is not None:
            if not isinstance(scenes, list):
                raise EstudioCardError("scenes debe ser una lista.")
            for scene in scenes:
                if (not isinstance(scene, dict) or type(scene.get("index")) is not int
                        or not isinstance(scene.get("title"), str)):
                    raise EstudioCardError("Una escena del plan es inválida.")
                for tag in scene.get("tags", []) or []:
                    if (not isinstance(tag, dict) or tag.get("type") not in _TAG_TYPES
                            or not isinstance(tag.get("label"), str)):
                        raise EstudioCardError("Una etiqueta de escena es inválida.")

    _assert_card_safe(card)
    return card


def estudio_card_or_none(card: dict | None) -> dict | None:
    """ACTIVACIÓN GATED: valida la tarjeta si hay dato REAL; con None no se pinta nada (sin simular)."""
    if card is None:
        return None
    return validate_estudio_card(card)


def estudio_engine_label(model_id: str) -> str:
    """Label card-safe del motor para la tarjeta, derivado del CATÁLOGO (p. ej. «Veo 3.1 Fast»);
    NUNCA el id crudo (D-PROTECCION). Fail-closed si el modelo no está en el catálogo. El cableado
    (Lote B) usa esto para `meta.engineLabel`/`imageMeta.engineLabel`, no un string libre."""
    from .creative_google_capabilities import model_label
    if not isinstance(model_id, str) or not model_id:
        raise EstudioCardError("Falta el id de modelo para el label.")
    label = model_label(model_id)
    if not isinstance(label, str) or not label:
        raise EstudioCardError("El modelo no está en el catálogo (no hay label card-safe).")
    _assert_card_safe_string(label, "engineLabel")
    return label


# Proyección ALLOWLIST: la tarjeta se CONSTRUYE con solo estos campos (se descarta cualquier otro del
# origen); el guard card-safe es la segunda red. Así un campo inesperado no cuela una fuga de valor
# (p. ej. un project-id suelto) aunque el denylist no lo cace.
_COMMON_KEYS = ("kind", "threadId", "title", "version")
_KIND_KEYS = {
    "plan": ("meta", "scenes", "maxEur", "payer", "quoteId"),
    "creating": ("items", "progress"),
    "result": ("items", "progress", "downloadUrl"),
    "images": ("images", "imageMeta", "downloadUrl"),
    "publish": ("publishTarget",),
}
_META_KEYS = ("format", "scenes", "durationSec", "aspect", "resolution", "engineLabel")
_SCENE_KEYS = ("index", "title", "subtitle", "tags")
_TAG_KEYS = ("type", "label")
_ITEM_KEYS = ("index", "title", "subtitle", "state", "durationSec", "posterUrl", "playUrl")
_IMAGE_KEYS = ("id", "label", "selected", "url", "previewUrl")
_PROGRESS_KEYS = ("current", "total")
_PUBLISH_KEYS = ("label", "detail")


def _pick(source: dict, allowed: tuple) -> dict:
    return {key: source[key] for key in allowed if key in source}


def _project_scene(scene: object) -> dict:
    if not isinstance(scene, dict):
        raise EstudioCardError("Una escena no es un objeto.")
    picked = _pick(scene, _SCENE_KEYS)
    if isinstance(picked.get("tags"), list):
        picked["tags"] = [_pick(tag, _TAG_KEYS) for tag in picked["tags"]
                          if isinstance(tag, dict)]
    return picked


def project_estudio_card(source: dict) -> dict:
    """PROYECCIÓN ALLOWLIST (builder): construye la tarjeta con SOLO los campos permitidos por kind
    (incluidas las estructuras anidadas), descartando cualquier otro, y la valida (guard de backstop).
    Es la vía recomendada por el Consultor: no se fía el scrubbing solo al guard."""
    if not isinstance(source, dict):
        raise EstudioCardError("El origen de la tarjeta no es un objeto.")
    kind = source.get("kind")
    if kind not in _KINDS:
        raise EstudioCardError("kind de tarjeta no reconocido.")
    card = _pick(source, _COMMON_KEYS + _KIND_KEYS[kind])
    if isinstance(card.get("meta"), dict):
        card["meta"] = _pick(card["meta"], _META_KEYS)
    if isinstance(card.get("imageMeta"), dict):
        card["imageMeta"] = _pick(card["imageMeta"], _META_KEYS)
    if isinstance(card.get("progress"), dict):
        card["progress"] = _pick(card["progress"], _PROGRESS_KEYS)
    if isinstance(card.get("publishTarget"), dict):
        card["publishTarget"] = _pick(card["publishTarget"], _PUBLISH_KEYS)
    if isinstance(card.get("scenes"), list):
        card["scenes"] = [_project_scene(scene) for scene in card["scenes"]]
    if isinstance(card.get("items"), list):
        card["items"] = [_pick(item, _ITEM_KEYS) for item in card["items"]
                         if isinstance(item, dict)]
    if isinstance(card.get("images"), list):
        card["images"] = [_pick(image, _IMAGE_KEYS) for image in card["images"]
                          if isinstance(image, dict)]
    return validate_estudio_card(card)


@dataclass(frozen=True)
class EstudioAction:
    """Acción estructurada de la tarjeta (POST /api/uony/messages), espejo de `formResponse`.

    OPCIÓN FUTURA (Frontend-app 23-10): HOY los botones van por la vía CONVERSACIONAL (sendPrompt →
    «Sí, crea la pieza», «Sí, publícalo», «Me quedo con la propuesta 1»), que interpreta el modelo y
    confirma por la ruta del «sí escrito» (`creative_estudio_spend`). `estudioAction` queda disponible
    por si se quiere DESPACHO ESTRUCTURADO IDEMPOTENTE; no se usa en el flujo actual. El GASTO/
    aprobación pasa por el gate C1-C9 del servidor en ambos caminos."""
    action: str                        # crear | cambiar | publicar | cancelar | cambiar_escena
    thread_id: str
    plan_id: str | None = None
    revision: int | None = None
    scene_index: int | None = None     # obligatorio solo en 'cambiar_escena'
    quote_id: str | None = None        # 'crear' que confirma una cotización
    approval_id: str | None = None     # 'crear' que confirma una aprobación ya emitida


def parse_estudio_action(payload: object) -> EstudioAction:
    """Parsea/valida el `estudioAction` entrante. Fail-closed; NO gasta (eso es el gate C1-C9)."""
    if not isinstance(payload, dict):
        raise EstudioCardError("estudioAction no es un objeto.")
    if payload.get("type") != "estudioAction":
        raise EstudioCardError("type no es estudioAction.")
    action = payload.get("action")
    if action not in _ACTIONS:
        raise EstudioCardError("Acción de Estudio no reconocida.")
    thread_id = payload.get("threadId")
    if not isinstance(thread_id, str) or not _UUID.fullmatch(thread_id):
        raise EstudioCardError("threadId no es un uuid.")
    for opt in ("planId", "quoteId", "approvalId"):
        if opt in payload and payload[opt] is not None:
            if not isinstance(payload[opt], str) or not _UUID.fullmatch(payload[opt]):
                raise EstudioCardError(f"{opt} no es un uuid.")
    revision = payload.get("revision")
    if revision is not None and (type(revision) is not int or revision < 1):
        raise EstudioCardError("revision no es un entero positivo.")
    scene_index = payload.get("sceneIndex")
    if action == "cambiar_escena":
        if type(scene_index) is not int or scene_index < 0:
            raise EstudioCardError("cambiar_escena requiere sceneIndex >= 0.")
    elif scene_index is not None:
        raise EstudioCardError("sceneIndex solo aplica a cambiar_escena.")
    return EstudioAction(
        action=action, thread_id=thread_id, plan_id=payload.get("planId"),
        revision=revision, scene_index=scene_index,
        quote_id=payload.get("quoteId"), approval_id=payload.get("approvalId"))

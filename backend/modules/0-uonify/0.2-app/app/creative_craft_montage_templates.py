"""Catálogo de plantillas de montaje Craft: intención del cliente -> receta ``video_assemble``.

Gemelo de estilo de ``creative_craft_amazon_export`` (planifica + valida, NO ejecuta).  Dada una
plantilla (T1 ficha de producto, T2 anuncio UGC), un destino y los ``CreativeAsset`` **adoptados**,
construye de forma **determinista** una receta ``video_assemble`` que el adapter ya sabe traducir
(``craft_adapter._canonical_film_plan``) y la **valida** contra el esquema real
(``creative_edit_recipe.EDIT_RECIPE``) fail-closed.  Devuelve, además, el ``export_preset`` real
(``creative_craft_amazon_export``) y una **proyección de medición** para Revisión-vídeos.

INERTE: no genera vídeo, no invoca FilmCraft/ffmpeg, no toca GCS/red/BD; es una función pura.  El
motor (worker-114, paso W2) la llamaría para obtener la receta; aquí solo se planifica.  Diseño:
``docs/migration/DISENO-PLANTILLAS-MONTAJE-CRAFT-20261026.md``.

Frontera (solo GA): clips Veo 3.1 Fast, imágenes Nano Banana, narración Chirp 3 HD, música
lyria-002.  Recorte hoy = solo cola/duración (``durationFrames``); el in-point (``sourceIn``) y la
pista de subtítulos son extensión recipe-v2 (fuera de este módulo).  Cap de 720p: 1080p/4K se
rechazan hasta que se cablee la generación y se repruebe (veredicto del Consultor).
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .creative_craft_amazon_export import AMAZON_EXPORT_PRESETS, AmazonExportPreset
from .creative_edit_recipe import EDIT_RECIPE, canonical_sha256


# Etiquetas GA internas (no ids crudos; card-safe).  Solo estos modelos alimentan el montaje.
_GA_MODELS = frozenset({"veo-3.1-fast", "nano-banana", "chirp-3-hd", "lyria-002"})

# Rol del asset -> pista del timeline (V=vídeo/imagen, A=audio).
_ROLE_TRACK = {
    "product_clip": "V1", "scene_clip": "V1",
    "overlay": "V2", "voice": "A1", "music": "A2",
}
_VIDEO_KINDS = ("image", "video", "image_sequence")

# Límite de generación verificado HOY (Revisión-vídeos §1 / INVENTARIO §E): 720p.  1080p/4K se
# rechazan hasta cablear + reprobar (recipe/gen-v2, Consultor).  720p = 1280x720 o 720x1280.
_MAX_EDGE_TODAY = 1280
_MIN_EDGE_TODAY = 720


class MontageTemplateError(ValueError):
    """Una intención de montaje no pudo convertirse en una receta válida.  Fail-closed."""


@dataclass(frozen=True)
class MontageInput:
    """Un ``CreativeAsset`` adoptado, con su rol en la plantilla y su etiqueta GA.

    ``asset`` es un dict con forma ``RecipeAsset`` (assetId, revision, kind, geometría/duración,
    receipt{...}); el builder lo coloca tal cual en ``recipe.assets`` tras validarlo.

    Mapea 1:1 con ``creative_asset_contract.CreativeAssetSnapshot`` (contrato de adopción de la capa
    de generación de Super Computer).  Tres matices de ese contrato que respeta W2 al construir el
    input:
      1. ``asset['frameRate']`` es un RACIONAL ``{numerator, denominator}`` (no float), como exige
         ``RecipeAsset.frameRate``.  El fps es exacto, sin deriva.
      2. ``asset['revision']`` se lee del registro ``creative_asset_revisions`` (migración 089),
         inmutable por revisión; no del draft de adopción.
      3. ``ready_for_craft`` = la propiedad del snapshot (``craft_blockers`` vacío).  Hoy
         ``image_sequence`` trae ``image_sequence_unpack_not_implemented`` y un audio con metadata
         incompleta ``audio_metadata_incomplete`` → ``ready_for_craft=False`` → se RECHAZA (no se
         asume consumible).  ``adopted`` y ``ready_for_craft`` deben ser True; ``model_label`` GA.
    """
    role: str
    asset: dict
    model_label: str
    adopted: bool
    ready_for_craft: bool = True
    chain_plane: bool = False


@dataclass(frozen=True)
class MontageTarget:
    """Destino de export: su preset real + el lienzo (16:9 o 9:16)."""
    key: str
    export_preset: str
    width: int
    height: int


# Destinos soportados en v1.  El lienzo se valida contra el preset real + el cap de 720p.
_TARGETS = {
    "amazon_listing_16x9": MontageTarget("amazon_listing_16x9", "amazon_listing_video", 1280, 720),
    "amazon_listing_9x16": MontageTarget("amazon_listing_9x16", "amazon_listing_video", 720, 1280),
    # Sponsored exige 1920x1080 EXACTO -> hoy inalcanzable (cap 720p); se rechaza fail-closed
    # hasta que se cablee 1080p.  Se declara para que el rechazo sea explícito y medible.
    "amazon_sponsored": MontageTarget("amazon_sponsored", "amazon_sponsored_ad", 1920, 1080),
}


@dataclass(frozen=True)
class MontageTemplateSpec:
    """Qué exige una plantilla: roles requeridos/opcionales y destinos admitidos."""
    template_id: str
    label: str
    required_roles: tuple[str, ...]
    optional_roles: tuple[str, ...]
    targets: tuple[str, ...]
    available: bool = True


_TEMPLATES = {
    "T1": MontageTemplateSpec(
        "T1", "Vídeo de producto (ficha)",
        required_roles=("product_clip",),
        optional_roles=("overlay", "voice", "music"),
        targets=("amazon_listing_16x9", "amazon_listing_9x16")),
    "T2": MontageTemplateSpec(
        "T2", "Anuncio UGC",
        required_roles=("product_clip",),
        optional_roles=("scene_clip", "overlay", "voice", "music"),
        targets=("amazon_listing_9x16", "amazon_sponsored")),
    # T3 cinemática y T4 explicador: declaradas; no disponibles en v1 (cadena/subtítulos dependen
    # de la extensión recipe-v2).  Se rechazan explícitas, no silenciosas.
    "T3": MontageTemplateSpec("T3", "Secuencia cinematográfica", (), (), (), available=False),
    "T4": MontageTemplateSpec("T4", "Explicador", (), (), (), available=False),
}


@dataclass(frozen=True)
class MontageRecipePlan:
    """Resultado inerte: la receta validada + su preset + medición + sha256 determinista."""
    template_id: str
    recipe: dict
    export_preset: str
    recipe_sha256: str
    measurement: dict = field(default_factory=dict)


def _preset(key: str) -> AmazonExportPreset:
    preset = AMAZON_EXPORT_PRESETS.get(key)
    if preset is None:
        raise MontageTemplateError(f"Preset de export desconocido: {key!r}.")
    return preset


def _check_canvas(target: MontageTarget, preset: AmazonExportPreset) -> None:
    long_edge, short_edge = max(target.width, target.height), min(target.width, target.height)
    if long_edge > _MAX_EDGE_TODAY or short_edge > _MIN_EDGE_TODAY:
        raise MontageTemplateError(
            "Resolución no cableada hoy (solo 720p); 1080p/4K pendiente del Consultor.")
    # Aspecto del lienzo vs preset.
    if target.width * 9 == target.height * 16:
        aspect = "16:9"
    elif target.width * 16 == target.height * 9:
        aspect = "9:16"
    else:
        raise MontageTemplateError("El vídeo solo admite 16:9 o 9:16 (1:1/21:9 son de imagen).")
    if aspect not in preset.aspects:
        raise MontageTemplateError(
            f"El aspecto {aspect} no corresponde al preset {preset.key}.")


def _fps(frame_rate: dict) -> float:
    return frame_rate["numerator"] / frame_rate["denominator"]


def _check_duration(preset: AmazonExportPreset, total_frames: int, frame_rate: dict) -> None:
    seconds = total_frames * frame_rate["denominator"] / frame_rate["numerator"]
    if preset.duration_exact_seconds is not None and abs(
            seconds - preset.duration_exact_seconds) > 0.1:
        raise MontageTemplateError(
            f"El preset {preset.key} exige {preset.duration_exact_seconds:g} s exactos.")
    if (preset.duration_max_seconds is not None
            and seconds > preset.duration_max_seconds + 0.1):
        raise MontageTemplateError(
            f"El montaje ({seconds:.2f} s) supera el máximo del preset ({preset.duration_max_seconds:g} s).")


def _validate_inputs(spec: MontageTemplateSpec, inputs: tuple[MontageInput, ...]) -> None:
    allowed = set(spec.required_roles) | set(spec.optional_roles)
    seen = set()
    for item in inputs:
        if not item.adopted:
            raise MontageTemplateError("Solo se montan CreativeAsset adoptados.")
        if not item.ready_for_craft:
            raise MontageTemplateError(
                "Asset no listo para Craft (craft_blockers no vacío): rechazo fail-closed.")
        if item.model_label not in _GA_MODELS:
            raise MontageTemplateError(f"Modelo no-GA rechazado: {item.model_label!r}.")
        if item.role not in allowed:
            raise MontageTemplateError(
                f"El rol {item.role!r} no corresponde a la plantilla {spec.template_id}.")
        track = _ROLE_TRACK.get(item.role)
        kind = item.asset.get("kind")
        if track is None:
            raise MontageTemplateError(f"Rol sin pista: {item.role!r}.")
        if track.startswith("V") and kind not in _VIDEO_KINDS:
            raise MontageTemplateError(f"El rol {item.role!r} (pista {track}) exige imagen/vídeo.")
        if track.startswith("A") and kind != "audio":
            raise MontageTemplateError(f"El rol {item.role!r} (pista {track}) exige audio.")
        seen.add(item.role)
    missing = [role for role in spec.required_roles if role not in seen]
    if missing:
        raise MontageTemplateError(f"Faltan roles requeridos: {missing}.")


def _placements(inputs: tuple[MontageInput, ...], shots: list[dict],
                ducking_gain_db: float) -> tuple[list[dict], int]:
    """Coloca los planos de V1 en secuencia y las pistas de overlay/voz/música.

    ``shots`` = orden de los planos de vídeo: ``[{"assetId", "durationFrames"}, ...]``.  Overlay,
    voz y música se colocan a longitud completa del timeline (startFrame 0).  La música lleva
    ``gainDb`` reducido (ducking bajo la voz) si hay narración.
    """
    by_role: dict[str, list[MontageInput]] = {}
    for item in inputs:
        by_role.setdefault(item.role, []).append(item)
    video_ids = {str(item.asset["assetId"]): item
                 for role in ("product_clip", "scene_clip")
                 for item in by_role.get(role, [])}
    placements: list[dict] = []
    cursor = 0
    for shot in shots:
        asset_id = str(shot["assetId"])
        if asset_id not in video_ids:
            raise MontageTemplateError(f"El plano {asset_id} no es un clip de vídeo del set.")
        duration = int(shot["durationFrames"])
        if duration < 1:
            raise MontageTemplateError("Un plano necesita durationFrames >= 1.")
        placements.append({"assetId": asset_id, "track": "V1",
                           "startFrame": cursor, "durationFrames": duration})
        cursor += duration
    total = cursor
    if total < 1:
        raise MontageTemplateError("El montaje necesita al menos un plano de vídeo.")
    for item in by_role.get("overlay", []):
        placements.append({"assetId": str(item.asset["assetId"]), "track": "V2",
                           "startFrame": 0, "durationFrames": total})
    has_voice = bool(by_role.get("voice"))
    for item in by_role.get("voice", []):
        placements.append({"assetId": str(item.asset["assetId"]), "track": "A1",
                           "startFrame": 0, "durationFrames": total})
    for item in by_role.get("music", []):
        row = {"assetId": str(item.asset["assetId"]), "track": "A2",
               "startFrame": 0, "durationFrames": total,
               "fadeStartFrame": 0, "fadeEndFrame": total}
        if has_voice:
            row["gainDb"] = ducking_gain_db  # música por debajo de la voz
        placements.append(row)
    return placements, total


def plan_montage_recipe(template_id: str, target_key: str,
                        inputs: tuple[MontageInput, ...], sources: dict, *,
                        shots: list[dict], frame_rate: dict | None = None,
                        ducking_gain_db: float = -18.0) -> MontageRecipePlan:
    """Construye y VALIDA una receta ``video_assemble`` desde una intención.  Fail-closed, inerte.

    ``inputs`` = assets adoptados+GA con su rol; ``sources`` = los 6 sha de ``RecipeSources`` del
    contexto de ejecución (el worker los aporta; aquí entran como dato, no se inventan); ``shots`` =
    orden/duración de los planos de V1.  No ejecuta nada: devuelve el plan para que W2 lo materialice.
    """
    spec = _TEMPLATES.get(template_id)
    if spec is None:
        raise MontageTemplateError(f"Plantilla desconocida: {template_id!r}.")
    if not spec.available:
        raise MontageTemplateError(
            f"La plantilla {template_id} ({spec.label}) no está disponible en v1.")
    if target_key not in spec.targets:
        raise MontageTemplateError(
            f"La plantilla {template_id} no admite el destino {target_key!r}.")
    target = _TARGETS[target_key]
    preset = _preset(target.export_preset)
    _check_canvas(target, preset)
    _validate_inputs(spec, inputs)
    rate = dict(frame_rate or {"numerator": 30, "denominator": 1})
    placements, total_frames = _placements(inputs, shots, ducking_gain_db)
    _check_duration(preset, total_frames, rate)
    canvas = {"widthPixels": target.width, "heightPixels": target.height,
              "frameRate": rate, "durationFrames": total_frames}
    assets = [item.asset for item in inputs]
    recipe = {
        "schemaVersion": 1, "kind": "video_assemble", "adapterOperation": "video_export",
        "sources": sources, "target": {"mode": "create"},
        "assets": assets, "canvas": canvas, "placements": placements,
        "outputMimeType": "video/mp4",
    }
    try:
        EDIT_RECIPE.validate_python(recipe)
    except Exception as error:  # pydantic ValidationError -> fail-closed con contexto
        raise MontageTemplateError(f"La receta no valida contra el esquema: {error}") from error
    measurement = {
        "canvas": {"widthPixels": target.width, "heightPixels": target.height,
                   "fps": _fps(rate), "durationFrames": total_frames},
        "placements": [{"track": p["track"], "startFrame": p["startFrame"],
                        "durationFrames": p["durationFrames"],
                        "gainDb": p.get("gainDb")} for p in placements],
        "assetsLineage": [{"assetId": str(item.asset["assetId"]), "role": item.role,
                           "model": item.model_label, "adopted": item.adopted,
                           "readyForCraft": item.ready_for_craft,
                           "chainPlane": item.chain_plane} for item in inputs],
        "exportPreset": target.export_preset,
        "aspect": "16:9" if target.width >= target.height else "9:16",
        # Medido sobre la SALIDA, no en la receta (Revisión-vídeos los calcula sobre el MP4):
        "outputMeasured": ["integrated_lufs", "visual_artifacts"],
        # Pendiente de extensión recipe-v2 (Consultor): in-point y subtítulos.
        "recipeV2Pending": ["sourceIn_inpoint", "subtitle_track"],
    }
    return MontageRecipePlan(
        template_id, recipe, target.export_preset, canonical_sha256(recipe), measurement)

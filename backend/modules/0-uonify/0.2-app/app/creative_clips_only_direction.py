"""Director «animar la foto» para el clip simple (clips-only). STAGED + INERTE + PURO.

Pieza de ArtCraft, paso 1 del módulo de vídeo. Produce el ``DirectedVideoBatch`` de **1 plano**
``reference_to_video`` (Veo 3.1 Fast image→video, PRIMER FOTOGRAMA) a partir de la foto propia del
cliente (identidad GCS ``uri+generation+sha256`` del owned_input, 140/§H) + su intención en lenguaje
natural. El clip adoptado es el entregable directo (sin montaje, sin voz; audio nativo de Veo).

Decisiones de DIRECCIÓN (ArtCraft):
  * **Primer fotograma GCS**, NO referencia-sujeto inline. Para un clip de producto e-commerce el
    resultado DEBE ser el producto EXACTO cobrando vida (image→video desde la foto real como
    fotograma 1), no una reinterpretación «de sujeto». El gate de propiedad §H ata la identidad por
    (uri, generation, sha256) del owned_input, ya residente en el bucket del cliente.
  * ``strategy_sha256`` = **hash canónico de ESTA dirección** (prompt + ShotDirection + foto +
    proporción + duración). Provenance honesta de la decisión creativa concreta. **NUNCA** un
    ``StrategyBinding`` sintético (categoría VETADA por el Consultor): un clip simple no tiene
    campaña (claims/beats/CTA), así que no se fabrica una.
  * Cámara ``hold`` por defecto (conserva encuadre/escala de la foto); ``spokenAudioMode='none'``
    (clips-only = solo video_generation, sin voiceover). Sin overlay de texto generado.

PURO: sin red, sin DB, sin estado, sin caller (inerte). 0 gasto. El flip sigue OFF.

ACOPLES DE PUERTO con Super Computer (a ratificar; «nada vivo sin doble verde Consultor+REA»):
  * **F1 (§H, prerequisito duro):** ``creative_veo_first_frame.veo_first_frame_request`` exige hoy
    ``output_uri``. Este director se compila en tiempo de COTIZACIÓN, donde el ``output_uri`` aún no
    existe (la reserva §6 lo acuña en DESPACHO; ``prepare_video_batch`` lo difiere con
    ``veo_output_uris=None``). ⇒ hace falta que ``veo_first_frame_request`` acepte
    ``output_uri=None`` (omitir ``_gcs_prefix`` y ``storageUri`` cuando None), ESPEJO EXACTO de
    ``veo_request`` (2 líneas, módulo §H → Consultor+REA). Mientras no se aplique, este módulo
    permanece INERTE (ningún caller). El ``storageUri`` lo inyecta el despacho en la reserva.
  * **F2 (draft builder, SC):** ``video_execution_draft`` exige un ``StrategyBinding``
    (incompatible con «sin StrategyBinding»). SC construye un draft builder clips-only que lleve
    ``directed.strategy_sha256`` DIRECTO (sin StrategyBinding). ``video_request_operations`` ya es
    agnóstico a estrategia (solo compara draft↔directed: project/model/skill/hashes).
  * **F3 (ensamblador de lote, confirmar ubicación):** ``prepare_video_batch`` no llama al builder
    de primer fotograma. Este módulo arma el ``VideoBatch`` de 1 plano con un ensamblador DEDICADO
    (``_assemble_frame_batch``) que REPLICA byte-a-byte la canonicalización de ``prepare_video_batch``
    (``batch_sha256``) para que los hashes aguas abajo cuadren, SIN tocar el compartido (montaje) =
    no-regresión. A ratificar: dedicado vs extender el compartido.
  * **F4 (identidad de skill, confirmar):** ``skill_version``/``skill_source_sha256`` del
    ``DirectedVideoBatch`` sin skill de marketing = identidad canónica del director de animación
    (``_DIRECTOR_VERSION`` + sha del esquema de dirección). El draft builder de SC DEBE portar los
    MISMOS valores (``video_request_operations`` los compara). A ratificar con Consultor.
"""
from __future__ import annotations

from .creative_composite_quote import canonical_sha256
from .creative_google_capabilities import ModelId
from .creative_request_fingerprint import fingerprint
from .creative_planning import AUDITED_PROJECT
from .creative_veo_first_frame import VeoFrameGcsReference, veo_first_frame_request
from .creative_video_batch import VideoBatch
from .creative_video_contracts import (VERIFIED_VIDEO_ASPECTS,
                                        VERIFIED_VIDEO_DURATIONS, VideoRequest)
from .creative_video_direction import DirectedVideoBatch, ShotDirection

# Identidad del director de animación clips-only (F4). No es un skill de marketing; es la versión de
# ESTA dirección. Los campos skill_* del DirectedVideoBatch la portan; el draft builder de SC debe
# usar los MISMOS valores (video_request_operations los compara).
_DIRECTOR = 'clips_only_animation_director'
_DIRECTOR_VERSION = 'clips-only-animation/1'
# sha de la identidad del director (fija por versión; no un hash de bytes de módulo = reproducible).
_DIRECTOR_SOURCE_SHA256 = canonical_sha256(
    {'director': _DIRECTOR, 'version': _DIRECTOR_VERSION, 'schemaVersion': 1})

# Motor verificado para image→video primer fotograma (catálogo, no literal crudo: guard H8).
# `.value` (el STRING del catálogo, no el miembro Enum) — ESPEJO EXACTO del patrón hermano
# `creative_video_contracts._VEO_FAST = ModelId.VEO_31_FAST.value`, que es como lo recibe `veo_request`.
# IMPRESCINDIBLE: `veo_first_frame_request`/`veo_request` interpolan el modelo en la URL del endpoint
# (`f'...models/{model}:predictLongRunning'`); en Python 3.12+ un miembro Enum se formatea como su REPR
# ('ModelId.VEO_31_FAST'), no su value, así que el endpoint persistido divergiría del `model` (value) y la
# reconstrucción del worker (loader `_veo`, `path.group(3) != model`) fallaría → VERIFY_RECONSTRUCT_INVALID.
# Pasar el value hace el endpoint correcto e invariante a la versión de Python. Sigue siendo catálogo (guard H8).
_FRAME_MODEL = ModelId.VEO_31_FAST.value
# Duración inicial confirmada por el dueño («8 s/720p para empezar»); el binding clips-only solo
# admite 8 s. Ampliar = cambio de config → Consultor.
_DURATION_SECONDS = 8
_SHOT_UNIT = 'shot-01'


class ClipsOnlyDirectionError(Exception):
    """Fail-closed: la dirección «animar la foto» no es válida."""


def _animation_shot(guidance: str) -> ShotDirection:
    """Una ShotDirection de animación con barandillas de preservación de producto.

    La intención del cliente (``guidance``) alimenta la ACCIÓN; el resto conserva el producto
    idéntico a la foto. Validada por el esquema estricto (longitudes, audio) fail-closed.
    """
    if not isinstance(guidance, str):
        raise ClipsOnlyDirectionError('La intención de animación debe ser texto.')
    intent = ' '.join(guidance.split()).strip()
    if not intent:
        raise ClipsOnlyDirectionError('Falta la intención de animación del cliente.')
    # La acción = movimiento sutil derivado de la intención, acotada al esquema (<=640).
    action = ('Movimiento sutil y físicamente plausible que da vida a la foto sin alterar el '
              f'producto: {intent}')[:640]
    try:
        return ShotDirection(
            unitId=_SHOT_UNIT,
            purpose='Dar vida a la foto del producto conservándolo idéntico al original.',
            framing=('Conservar el encuadre, la escala, el fondo y el color de la foto original; '
                     'el producto permanece reconocible en todo momento.'),
            action=action,
            camera='hold',
            endState=('El producto queda tal y como aparece en la foto, sin deformaciones, '
                      'cambios de identidad ni elementos añadidos.'),
            transition='continuous',
            spokenAudioMode='none',
            overlayText=[],
        )
    except ValueError as exc:  # esquema estricto → fail-closed con mensaje propio
        raise ClipsOnlyDirectionError(f'Dirección de animación no válida: {exc}') from exc


def _animation_prompt(direction: ShotDirection) -> str:
    """Prompt Veo del plano único (estilo/barandillas gemelos de creative_video_direction._prompt).

    Sin marcas de tiempo de unidad (no hay compilación/montaje): es un clip autónomo.
    """
    return (
        'Animate the provided product photograph as the first frame of the clip. '
        f'Purpose: {direction.purpose.strip()} '
        f'Framing: {direction.framing.strip()} '
        f'Action: {direction.action.strip()} '
        f'Camera: {direction.camera.replace("_", " ")} (hold the product framed exactly as shot). '
        f'End state: {direction.endState.strip()} '
        'Preserve the product exactly: shape, proportions, colour, materials, text and logos must '
        'remain identical to the photo; subtle, physically plausible motion only; preserve physical '
        'cause, contact and consequence. '
        'No spoken words or added music; native audio only. '
        'No generated graphic text; preserve clear finishing space. '
        'Do not invent brands, proof, testimonials or interface states.')


def _assemble_frame_batch(request: VideoRequest, *, project: str) -> VideoBatch:
    """VideoBatch de 1 plano primer-fotograma (F3). Replica la canonicalización de
    ``prepare_video_batch`` para que ``batch_sha256``/``request_hashes`` cuadren aguas abajo.

    ``veo_media_subtotal_usd=None``: la tarifa/techos AUTORITATIVOS los calcula la
    ``pricing_readiness`` de SC (dominio pricing), que el draft toma por separado; el subtotal del
    lote es solo informativo y aquí se deja sin fijar. **AVISO F5 (SC + Consultor):** la pricing
    auditada hoy (``creative_pricing.veo_rate_estimate``) reconoce SOLO la forma INLINE
    (``referenceImages``) y ``aspectRatio`` 16:9; debe reconocer la forma PRIMER FOTOGRAMA
    (``image.gcsUri``, manifest ``role='first_frame'``) y 9:16 antes de cotizar el clip.
    """
    import json
    from hashlib import sha256
    hashes = (fingerprint(request).sha256,)
    canonical = json.dumps({'project': project, 'model': _FRAME_MODEL,
                            'requestedSeconds': _DURATION_SECONDS,
                            'requestHashes': hashes},
                           sort_keys=True, separators=(',', ':'))
    return VideoBatch(
        project, _FRAME_MODEL, _DURATION_SECONDS, _DURATION_SECONDS, 0,
        (request,), hashes, sha256(canonical.encode()).hexdigest(), None)


def _direction_strategy_sha256(photo: VeoFrameGcsReference, aspect_ratio: str,
                               direction: ShotDirection, prompt: str) -> str:
    """Hash canónico de ESTA dirección (= strategy_sha256). No es un StrategyBinding."""
    return canonical_sha256({
        'schemaVersion': 1,
        'kind': 'clips_only_animation',
        'directorVersion': _DIRECTOR_VERSION,
        'photo': {'sha256': photo.sha256, 'generation': photo.generation, 'uri': photo.uri},
        'aspectRatio': aspect_ratio,
        'durationSeconds': _DURATION_SECONDS,
        'direction': direction.model_dump(mode='json'),
        'prompt': prompt,
    })


def compile_clips_only_animation_batch(
        photo: VeoFrameGcsReference, *, project: str, aspect_ratio: str,
        guidance: str) -> DirectedVideoBatch:
    """Dirección «animar la foto»: 1 plano reference_to_video (primer fotograma Veo 3.1 Fast).

    ``photo``: owned_input resuelto a identidad GCS (uri+generation+sha256). ``project`` ==
    AUDITED_PROJECT. ``aspect_ratio`` ∈ {16:9, 9:16}. ``guidance``: intención de animación del
    cliente en lenguaje natural. Devuelve un ``DirectedVideoBatch`` de 1 plano, sin voz, con
    ``strategy_sha256`` = hash de esta dirección y ``execution_authorized=False``.

    INERTE hasta F1 (output_uri opcional en veo_first_frame_request). No ejecuta ni cotiza.
    """
    if project != AUDITED_PROJECT:
        raise ClipsOnlyDirectionError('El proyecto Google no coincide con la capacidad auditada.')
    if aspect_ratio not in VERIFIED_VIDEO_ASPECTS:
        raise ClipsOnlyDirectionError('Proporción de vídeo no verificada (solo 16:9 o 9:16).')
    if _DURATION_SECONDS not in VERIFIED_VIDEO_DURATIONS:  # invariante de config
        raise ClipsOnlyDirectionError('Duración de clip no verificada.')
    direction = _animation_shot(guidance)
    prompt = _animation_prompt(direction)
    # F1: output_uri se difiere a la reserva §6 (despacho). Requiere veo_first_frame_request con
    # output_uri opcional (espejo de veo_request). El builder valida la identidad §H de la foto.
    request = veo_first_frame_request(
        project, _FRAME_MODEL, prompt, photo, output_uri=None,
        aspect_ratio=aspect_ratio, duration_seconds=_DURATION_SECONDS)
    batch = _assemble_frame_batch(request, project=project)
    strategy_sha256 = _direction_strategy_sha256(photo, aspect_ratio, direction, prompt)
    return DirectedVideoBatch(
        _DIRECTOR_VERSION, _DIRECTOR_SOURCE_SHA256, (direction,), batch,
        (), strategy_sha256, False)

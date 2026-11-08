"""Registro de motores de vídeo — oferta variable configurable sin redeploy (dictamen 27-10 §C.1).

El cliente pide una **ETIQUETA** (un tratamiento: «clip rápido 8 s», «clip de calidad 1080p»),
NUNCA un motor. Cada etiqueta mapea a una **lista ordenada de candidatos** cuyo último, si la
etiqueta está «respaldada por GA», es GA (red de seguridad §C.3). El registro es el ÚNICO camino
invocable (allowlist cerrado, §5 del dictamen): un model-id que no esté en una etiqueta no existe
para el runner.

Qué manda el CATÁLOGO (fuente única H8, `creative_google_capabilities`) y qué manda la CONFIG:
  * catálogo → estado GA/Preview (`model_launch_stage`), región (`model_location`), etiqueta de
    cliente (`model_label`), api (Veo=predictLongRunning / Omni=interactions, derivada de los
    conjuntos del catálogo). La config NO puede mentir sobre la GA-idad ni re-listar ids.
  * config (admin, editable sin redeploy) → por candidato: `enabled` (kill-switch) + `retires_at`
    (vencimiento) + `price_usd` (coste conocido, o None=[NV] para un Preview aún sin precio real).

STAGED + INERTE: estructuras puras, sin DB, sin red, sin llamador. La persistencia/CRUD del admin
es superficie de interfaz/admin-backend; aquí vive el CONTRATO (forma del snapshot) + la validación
fail-closed + la resolución. D-PROTECCIÓN: al cliente se le da `display_label`, nunca el model-id.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Mapping

from .creative_google_capabilities import (model_label, model_launch_stage,
                                           model_location, omni_model_ids,
                                           veo_model_ids)

# Api de cada motor, derivada del catálogo (no es parámetro libre): Veo usa el
# predictLongRunning de Vertex; Omni usa la Interactions API (dictamen §A/§B). Un model-id que no
# esté en ninguno de los dos conjuntos NO es un motor de vídeo invocable → fail-closed.
_PREDICT_LRO = 'predictLongRunning'
_INTERACTIONS = 'interactions'

_BACKINGS = frozenset({'ga_backed', 'preview_only'})


class EngineRegistryError(Exception):
    """Fail-closed: la configuración del registro de motores no es válida y segura."""


@dataclass(frozen=True)
class EngineCandidate:
    """Un motor concreto dentro de una etiqueta. Los campos de identidad (model/api/region/stage)
    vienen del catálogo; los operativos (enabled/retires_at/price) y los de política
    (data_safe/commercial_ok) de la config del admin.

    `data_safe`/`commercial_ok` (veredicto oferta-motores 27-10): banderas por candidato que consume
    el RECOMENDADOR (creative_video_engine_recommender). GA = ✅✅; Preview = condicional. Sus VALORES
    finales los cierra Legal (lee los «Additional Terms GenAI Preview» de cada modelo); aquí es config
    inyectada, NUNCA inferida — fail-closed si falta."""
    model: str
    api: str
    region: str
    launch_stage: str          # 'ga' | 'preview' | … (del catálogo)
    enabled: bool
    retires_at: datetime | None
    price_usd: Decimal | None   # None = precio [NV] (p. ej. Omni sin prueba real)
    data_safe: bool             # ✅ si no usa entradas del cliente para entrenar (Legal lo cierra)
    commercial_ok: bool         # ✅ si el uso comercial está permitido por términos (GA sí; Preview as-is)
    # Cuándo verificó Legal los términos del Preview (lista de excepción comercial, página FECHADA que
    # CAMBIA SIN AVISO). Lo consume la caducidad del recomendador: un commercial_ok=True de Preview
    # solo vale dentro de la ventana desde esta fecha; vencido ⇒ fail-closed (no ofrecible comercial).
    # GA no lo usa (términos estables). None = sin verificar → un Preview commercial_ok=True cae a False.
    commercial_ok_verified_at: datetime | None = None

    @property
    def is_ga(self) -> bool:
        return self.launch_stage == 'ga'

    def active(self, now: datetime) -> bool:
        """Config/kill-switch (§C.2, capa 1): un candidato desactivado o con el vencimiento pasado
        sale al instante, antes de cualquier intento de red."""
        return self.enabled and (self.retires_at is None or self.retires_at > now)


@dataclass(frozen=True)
class VideoTreatment:
    """Una etiqueta (tratamiento) y su cadena ordenada de candidatos."""
    label: str                 # etiqueta interna (clave de mapeo)
    display_label: str         # lo que ve el cliente (card-safe, del catálogo)
    backing: str               # 'ga_backed' | 'preview_only'
    degrades_to: str | None    # etiqueta GA más cercana si cae (solo preview_only)
    candidates: tuple[EngineCandidate, ...]

    @property
    def ga_backed(self) -> bool:
        return self.backing == 'ga_backed'


@dataclass(frozen=True)
class TreatmentResolution:
    """Candidatos ACTIVOS de una etiqueta, en orden de preferencia. Para `ga_backed` el último es
    GA (fallback transparente). Para `preview_only`, `degrades_to` indica a qué etiqueta GA degradar
    INFORMANDO si todos estos candidatos se agotan en runtime (nunca sustituir en silencio §C.3)."""
    label: str
    candidates: tuple[EngineCandidate, ...]
    ga_backed: bool
    degrades_to: str | None


@dataclass(frozen=True)
class TreatmentDegraded:
    """La etiqueta solo-Preview no tiene ahora ningún candidato activo. NO se entrega algo distinto
    en silencio: se informa y se ofrece la etiqueta GA más cercana (§C.3)."""
    label: str
    degrades_to: str
    client_message: str


_DEGRADE_MESSAGE = (
    'Ese tratamiento no está disponible ahora mismo; te ofrecemos el más parecido disponible.')


@dataclass(frozen=True)
class VideoEngineRegistry:
    treatments: Mapping[str, VideoTreatment]

    def resolve(self, label: str, *, now: datetime) -> TreatmentResolution | TreatmentDegraded:
        """Devuelve los candidatos activos de la etiqueta (allowlist cerrado: una etiqueta que no
        existe se rechaza). ga_backed garantiza suelo GA activo; preview_only agotada → degradar."""
        if not isinstance(now, datetime) or now.tzinfo is None:
            raise EngineRegistryError('`now` debe ser datetime con zona horaria.')
        treatment = self.treatments.get(label) if isinstance(label, str) else None
        if treatment is None:
            raise EngineRegistryError('Etiqueta de tratamiento no reconocida.')
        active = tuple(c for c in treatment.candidates if c.active(now))
        if treatment.ga_backed:
            # Invariante de seguridad: una etiqueta GA sin suelo GA activo es una config rota; no se
            # ofrece a medias (fail-closed). El validador ya exige que el último candidato sea GA;
            # aquí se comprueba que ese suelo siga activo tras aplicar kill-switch/retires_at.
            if not active or not active[-1].is_ga:
                raise EngineRegistryError(
                    'La etiqueta respaldada por GA se quedó sin suelo GA activo.')
            return TreatmentResolution(label, active, True, None)
        # preview_only
        if not active:
            return TreatmentDegraded(label, treatment.degrades_to, _DEGRADE_MESSAGE)
        return TreatmentResolution(label, active, False, treatment.degrades_to)


# ---------------------------------------------------------------------------------------------
# Construcción + validación del registro desde el snapshot de config (admin, sin redeploy).
# ---------------------------------------------------------------------------------------------

def _api_for(model: str) -> str:
    if model in veo_model_ids():
        return _PREDICT_LRO
    if model in omni_model_ids():
        return _INTERACTIONS
    raise EngineRegistryError('El motor no es un modelo de vídeo invocable del catálogo.')


def _candidate(raw: object, now: datetime) -> EngineCandidate:
    if not isinstance(raw, dict):
        raise EngineRegistryError('Candidato de motor con forma inválida.')
    model = raw.get('model')
    stage = model_launch_stage(model) if isinstance(model, str) else None
    region = model_location(model) if isinstance(model, str) else None
    if stage is None or region is None:
        # Allowlist cerrado (§5): solo model-ids del catálogo son invocables.
        raise EngineRegistryError('El motor no pertenece al catálogo Google verificado.')
    enabled = raw.get('enabled')
    if not isinstance(enabled, bool):
        raise EngineRegistryError('`enabled` del candidato debe ser booleano.')
    retires_at = raw.get('retiresAt')
    if retires_at is not None:
        if not isinstance(retires_at, datetime) or retires_at.tzinfo is None:
            raise EngineRegistryError('`retiresAt` debe ser datetime con zona horaria o None.')
    price_raw = raw.get('priceUsd')
    if price_raw is None:
        price = None
    else:
        try:
            price = Decimal(str(price_raw))
        except (InvalidOperation, ValueError, TypeError) as error:
            raise EngineRegistryError('`priceUsd` no es un decimal válido.') from error
        if price <= 0:
            raise EngineRegistryError('`priceUsd` debe ser positivo o None ([NV]).')
    data_safe = raw.get('dataSafe')
    commercial_ok = raw.get('commercialOk')
    if not isinstance(data_safe, bool) or not isinstance(commercial_ok, bool):
        # Fail-closed: las banderas de política son obligatorias y explícitas (Legal), nunca
        # inferidas de la GA-idad ni con defecto permisivo.
        raise EngineRegistryError('`dataSafe` y `commercialOk` del candidato deben ser booleanos.')
    verified_at = raw.get('commercialOkVerifiedAt')  # opcional; None ⇒ Preview commercial_ok cae a False
    if verified_at is not None and (not isinstance(verified_at, datetime)
                                    or verified_at.tzinfo is None):
        raise EngineRegistryError(
            '`commercialOkVerifiedAt` debe ser datetime con zona horaria o None.')
    return EngineCandidate(model, _api_for(model), region, stage, enabled,
                           retires_at, price, data_safe, commercial_ok, verified_at)


def _treatment(raw: object, now: datetime) -> VideoTreatment:
    if not isinstance(raw, dict):
        raise EngineRegistryError('Tratamiento con forma inválida.')
    label = raw.get('label')
    if not isinstance(label, str) or not label:
        raise EngineRegistryError('La etiqueta del tratamiento es obligatoria.')
    backing = raw.get('backing')
    if backing not in _BACKINGS:
        raise EngineRegistryError('`backing` debe ser ga_backed o preview_only.')
    candidates_raw = raw.get('candidates')
    if not isinstance(candidates_raw, list) or not candidates_raw:
        raise EngineRegistryError('El tratamiento necesita al menos un candidato.')
    candidates = tuple(_candidate(item, now) for item in candidates_raw)
    models = [c.model for c in candidates]
    if len(set(models)) != len(models):
        raise EngineRegistryError('Un tratamiento no puede repetir un motor.')
    if backing == 'ga_backed':
        # «El último siempre es GA» (§C.1/§C.3): suelo GA garantizado en config, no solo en runtime.
        if not candidates[-1].is_ga:
            raise EngineRegistryError('Una etiqueta respaldada por GA debe terminar en un motor GA.')
        degrades_to = None
    else:  # preview_only: sin equivalente GA → degrada informando a otra etiqueta GA.
        degrades_to = raw.get('degradesTo')
        if not isinstance(degrades_to, str) or not degrades_to:
            raise EngineRegistryError('Una etiqueta solo-Preview debe declarar `degradesTo`.')
        if degrades_to == label:
            raise EngineRegistryError('`degradesTo` no puede apuntar a la propia etiqueta.')
    # display_label del catálogo (card-safe): se usa el del candidato preferido; si el admin fija
    # uno explícito, prevalece, pero NUNCA se expone el model-id crudo.
    display = raw.get('displayLabel')
    if display is not None and (not isinstance(display, str) or not display):
        raise EngineRegistryError('`displayLabel` debe ser texto no vacío o None.')
    if display is None:
        display = model_label(candidates[0].model)
        if not display:
            raise EngineRegistryError('No hay etiqueta de cliente para el motor preferido.')
    return VideoTreatment(label, display, backing, degrades_to, candidates)


def build_engine_registry(snapshot: object, *, now: datetime) -> VideoEngineRegistry:
    """Valida y congela el registro desde el snapshot de config del admin. Fail-closed ante
    cualquier violación (motor fuera del catálogo, etiqueta GA sin suelo GA, solo-Preview sin
    `degradesTo`, precio inválido). `now` ancla la validación de `retiresAt`."""
    if not isinstance(now, datetime) or now.tzinfo is None:
        raise EngineRegistryError('`now` debe ser datetime con zona horaria.')
    if not isinstance(snapshot, dict) or snapshot.get('schemaVersion') != 1:
        raise EngineRegistryError('Snapshot de registro con versión/forma no soportada.')
    treatments_raw = snapshot.get('treatments')
    if not isinstance(treatments_raw, list) or not treatments_raw:
        raise EngineRegistryError('El registro necesita al menos un tratamiento.')
    treatments: dict[str, VideoTreatment] = {}
    for item in treatments_raw:
        treatment = _treatment(item, now)
        if treatment.label in treatments:
            raise EngineRegistryError('Etiqueta de tratamiento duplicada.')
        treatments[treatment.label] = treatment
    # Integridad referencial: todo `degradesTo` de solo-Preview apunta a una etiqueta ga_backed real.
    for treatment in treatments.values():
        if treatment.backing == 'preview_only':
            target = treatments.get(treatment.degrades_to)
            if target is None or not target.ga_backed:
                raise EngineRegistryError(
                    '`degradesTo` debe apuntar a una etiqueta respaldada por GA existente.')
    return VideoEngineRegistry(dict(treatments))

"""Clasificador de disponibilidad + planificador de fallback (dictamen 27-10 §C.2–§C.3).

Reusa la taxonomía Veo YA aprobada del transporte (`creative_google_transport`) en vez de
reimplantarla: traduce cada clase de rechazo a una DECISIÓN de fallback. Reglas del dictamen:

  * **404 / model-not-found / Preview-unavailable = fallo DETERMINISTA de disponibilidad → FALLBACK**
    al siguiente candidato de la etiqueta.
  * **408/429 = transitorio → REINTENTO DEL MISMO motor** (no quemar otro por un parpadeo).
  * **Un 200 con bloqueo RAI/empty NO es fallo de disponibilidad → NO fallback** (el otro motor
    bloquearía igual y cobraría de más). Es contenido, no disponibilidad.
  * El fallback solo ocurre **ANTES** de una generación con éxito; cada candidato es un intento
    NUEVO (su propio attemptId + storageUri únicos), nunca un reintento ciego del anterior.

DOS COSTURAS marcadas al Consultor (no se inventan aquí):
  1. En el camino de DISPATCH, el transporte colapsa 400/401/403/404 en `GoogleDispatchRejectedFinal`
     SIN exponer el código, así que un 404 (disponibilidad) no se distingue de un 400/403 (terminal).
     Este clasificador NO adivina: exige una señal `availability` explícita; ausente ⇒ clasifica
     conservador como TERMINAL (no fallback). La clase 404-propia solo existe hoy en el POLL
     (`VeoRecoveryNotFound`). Cablear el fallback-por-404 en dispatch requiere que el transporte
     exponga el código → decisión del Consultor.
  2. El transporte clasifica **5xx = `GoogleDispatchUnknown`** (incierto, «no repetir»), mientras el
     dictamen agrupa «429/5xx = transitorio». Aquí se honra el invariante conservador existente
     (incierto ⇒ ni reintento ni fallback automáticos) y se MARCA la divergencia.

STAGED + INERTE: funciones puras, sin red, sin ledger, sin llamador.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from decimal import Decimal
from enum import Enum

from .creative_google_transport import (GoogleDispatchError,
                                         GoogleDispatchRejectedFinal,
                                         GoogleDispatchRejectedRetryable,
                                         GoogleDispatchSafetyBlocked,
                                         GoogleDispatchUnknown)
from .creative_google_transport import \
    GoogleDispatchEmptyResult  # noqa: E501  (subclase de RejectedFinal)
from .creative_video_engine_registry import EngineCandidate


class DispatchOutcome(Enum):
    """Clase de resultado de UN intento de despacho, derivada de la taxonomía del transporte."""
    SUCCESS = 'success'
    AVAILABILITY_UNAVAILABLE = 'availability_unavailable'   # 404 / model-not-found
    TRANSIENT = 'transient'                                 # 408/429
    CONTENT_BLOCKED = 'content_blocked'                     # 200 RAI / empty determinista
    TERMINAL_OTHER = 'terminal_other'                       # 400/401/403 u otro 4xx terminal
    UNCERTAIN = 'uncertain'                                 # 5xx / red / 200 ilegible / aceptado


class FallbackAction(Enum):
    """Qué hacer tras clasificar el intento."""
    STOP_DELIVERED = 'stop_delivered'          # hubo éxito; no hay nada que hacer
    FALLBACK_NEXT = 'fallback_next_candidate'  # intento NUEVO con el siguiente candidato
    RETRY_SAME = 'retry_same_engine'           # reintento del MISMO motor (transitorio)
    STOP_TERMINAL = 'stop_terminal'            # rechazo determinista no-disponibilidad
    STOP_CONTENT = 'stop_content'              # bloqueo de contenido: otro motor bloquearía igual
    STOP_UNCERTAIN = 'stop_uncertain'          # incierto: nunca repetir/caer automáticamente


_DECISION = {
    DispatchOutcome.SUCCESS: FallbackAction.STOP_DELIVERED,
    DispatchOutcome.AVAILABILITY_UNAVAILABLE: FallbackAction.FALLBACK_NEXT,
    DispatchOutcome.TRANSIENT: FallbackAction.RETRY_SAME,
    DispatchOutcome.CONTENT_BLOCKED: FallbackAction.STOP_CONTENT,
    DispatchOutcome.TERMINAL_OTHER: FallbackAction.STOP_TERMINAL,
    DispatchOutcome.UNCERTAIN: FallbackAction.STOP_UNCERTAIN,
}


def decide(outcome: DispatchOutcome) -> FallbackAction:
    """Mapa puro resultado→acción. El fallback (FALLBACK_NEXT) SOLO lo produce un fallo de
    disponibilidad; ni el contenido ni lo incierto caen a otro motor (evita doble cobro/sorpresa)."""
    if not isinstance(outcome, DispatchOutcome):
        raise TypeError('outcome debe ser un DispatchOutcome.')
    return _DECISION[outcome]


# Motivo de un 404 de modelo retirado/inexistente (cuerpo Veo-UE «Publisher model … was not
# found»): status NOT_FOUND o mensaje con «not found».
_MODEL_NOT_FOUND = re.compile(r'not[ _-]?found', re.IGNORECASE)


def _is_availability_failure(error: GoogleDispatchRejectedFinal) -> bool:
    """COSTURA 1 resuelta con el micro-parche Q1: un 404 del POST de generación es la ruta del
    publisher-model (no existe el model-id/ruta) → no se generó nada → fallback seguro. Cualquier
    otro 4xx final (400/401/403) sigue terminal. Si el transporte aún no expone `status_code`
    (código viejo sin el micro-parche), devuelve False (conservador: sin señal ⇒ terminal). Un 404
    con cuerpo ilegible (`reason` None) se trata como no-encontrado: en esta ruta un POST 404 no
    puede ser otra cosa (el proyecto/región se validan pre-POST), así se evita un falso-negativo
    (no caer cuando se debía). El Consultor confirma la forma exacta del motivo en real."""
    if getattr(error, 'status_code', None) != 404:
        return False
    reason = getattr(error, 'reason', None)
    return reason is None or bool(_MODEL_NOT_FOUND.search(reason))


def classify_dispatch_error(error: GoogleDispatchError, *,
                            availability: bool | None = None) -> DispatchOutcome:
    """Traduce una excepción del transporte a una clase de resultado.

    Para `GoogleDispatchRejectedFinal` genérico, la disponibilidad se DERIVA de la excepción
    (status_code==404 + motivo model-not-found, micro-parche Q1). `availability` explícito es un
    override opcional (tests/callers): True ⇒ disponibilidad, False ⇒ terminal, None ⇒ derivar.
    Safety/empty son contenido SIEMPRE (ignoran `availability`): un 200 bloqueado nunca es
    disponibilidad; el otro motor bloquearía igual y cobraría de más."""
    if isinstance(error, (GoogleDispatchSafetyBlocked, GoogleDispatchEmptyResult)):
        return DispatchOutcome.CONTENT_BLOCKED
    if isinstance(error, GoogleDispatchRejectedRetryable):
        return DispatchOutcome.TRANSIENT
    if isinstance(error, GoogleDispatchUnknown):
        return DispatchOutcome.UNCERTAIN
    if isinstance(error, GoogleDispatchRejectedFinal):
        resolved = availability if availability is not None else _is_availability_failure(error)
        return (DispatchOutcome.AVAILABILITY_UNAVAILABLE if resolved
                else DispatchOutcome.TERMINAL_OTHER)
    raise TypeError('error debe ser una excepción del transporte Google.')


# ---------------------------------------------------------------------------------------------
# Planificador de fallback: ordena los candidatos ejecutables bajo la cota de presupuesto GA.
# ---------------------------------------------------------------------------------------------

class FallbackPlanError(Exception):
    """Fail-closed: no se puede planificar un fallback seguro bajo la cota aprobada."""


@dataclass(frozen=True)
class FallbackStep:
    """Un intento planificado. `fresh_attempt=True` recuerda el invariante §C.3: cada candidato es
    un intento NUEVO (attemptId + storageUri propios), jamás un reintento ciego del anterior. La
    ejecución (reserva→dispatch) es del coordinador; aquí solo se declara el orden y el invariante."""
    candidate: EngineCandidate
    fresh_attempt: bool = True


@dataclass(frozen=True)
class FallbackPlan:
    steps: tuple[FallbackStep, ...]
    skipped_unpriced: tuple[str, ...]   # motores saltados por precio [NV] (card-safe: por model-id interno)


def plan_fallback(candidates: tuple[EngineCandidate, ...], *,
                  approved_max_usd: Decimal) -> FallbackPlan:
    """Ordena los candidatos ACTIVOS en pasos de intento, acotando al presupuesto aprobado.

    Cota (§C.3): `approved_max_usd` = el precio del GA, que sí conocemos. Caer hacia GA nunca supera
    lo aprobado. Un candidato con precio conocido > cota se SALTA (no se intenta algo que excede la
    aprobación del cliente). Un candidato con precio [NV]=None (p. ej. Omni sin prueba real) se SALTA
    fail-closed: no se puede garantizar ≤ cota sin precio → no se intenta hasta tener precio real.
    Si tras filtrar no queda ningún paso, es error (la etiqueta no es ofrecible con esta cota)."""
    if not isinstance(approved_max_usd, Decimal) or approved_max_usd <= 0:
        raise FallbackPlanError('La cota aprobada debe ser un Decimal positivo.')
    if not candidates:
        raise FallbackPlanError('No hay candidatos activos que planificar.')
    steps: list[FallbackStep] = []
    skipped: list[str] = []
    for candidate in candidates:
        if candidate.price_usd is None or candidate.price_usd > approved_max_usd:
            skipped.append(candidate.model)
            continue
        steps.append(FallbackStep(candidate, True))
    if not steps:
        raise FallbackPlanError(
            'Ningún candidato con precio conocido cabe en la cota aprobada.')
    return FallbackPlan(tuple(steps), tuple(skipped))

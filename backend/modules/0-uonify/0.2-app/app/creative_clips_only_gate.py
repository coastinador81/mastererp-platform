"""`gate_decider` de CONFIRMACIÓN POR GENERACIÓN (decisión del dueño 27-10, vía interfaz).

Antes de CADA clip, el cliente ve el coste aprox en € (de su cuenta) y pulsa «generar»; sin esa
confirmación explícita de ESE `requestSha256`, NO se despacha. Este decider implementa la firma que
espera `run_google_generation_once` (`gate_decider(claim, request_sha256) -> bool`) y SUSTITUYE al
`_fail_closed_gate` por defecto SOLO cuando se cablee (tras REA + Consultor): abre el gate únicamente
si existe una confirmación de cliente válida para `(user_id, job_id, request_sha256)` exactos.

SEGURIDAD (para el rayos-X de REA + el veredicto del Consultor):
  * Este módulo SOLO LEE la confirmación (vía `lookup` inyectado); NUNCA la crea. La confirmación la
    escribe un acto del CLIENTE autenticado (el botón «generar» → endpoint autenticado), jamás el
    modelo ni un worker → separación card/token: el modelo propone/cotiza, el CLIENTE confirma, el
    servidor liga ambos por `requestSha256`. El modelo no puede gastar por su cuenta.
  * `source == 'client_explicit'` es obligatorio: una confirmación marcada como de modelo/worker se
    RECHAZA (defensa contra una confirmación fabricada aguas arriba).
  * Match EXACTO de `(user_id, job_id, request_sha256)`: una confirmación de otra petición/otro job
    no autoriza esta. Caducidad fail-closed (`max_age`): una confirmación vieja no abre el gate (el
    precio pudo cambiar; re-confirmar).
  * Fail-closed total: cualquier ausencia, mismatch, forma inesperada o excepción ⇒ False.

STAGED + INERTE: función pura sobre un `lookup` inyectado; sin red/DB propias; sin llamador (el
coordinador sigue en `_fail_closed_gate`). D-PROTECCIÓN: el € y la tarjeta visible son de Frontend-app;
aquí no se expone coste ni ids.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Callable, Protocol, runtime_checkable

_HASH = re.compile(r'[0-9a-f]{64}\Z')
_CLIENT_SOURCE = 'client_explicit'
_DEFAULT_MAX_AGE = timedelta(hours=1)


@dataclass(frozen=True)
class GenerationConfirmation:
    """La confirmación explícita del cliente para una generación exacta (la LEE el decider)."""
    user_id: str
    job_id: str
    request_sha256: str
    confirmed_at: datetime
    source: str                      # debe ser 'client_explicit'


@runtime_checkable
class GenerationConfirmationLookup(Protocol):
    """Lee la confirmación persistida por el acto del cliente. Devuelve None si no existe."""

    def confirmed(self, claim, request_sha256: str) -> GenerationConfirmation | None:
        ...


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def clips_only_gate_decider(
        lookup: GenerationConfirmationLookup, *,
        now_provider: Callable[[], datetime] = _utcnow,
        max_age: timedelta = _DEFAULT_MAX_AGE) -> Callable[[object, str], bool]:
    """Devuelve el `gate_decider(claim, request_sha256) -> bool` para el coordinador. Fail-closed:
    solo True con una confirmación de cliente válida y vigente para esta generación exacta."""
    if not callable(getattr(lookup, 'confirmed', None)):
        raise ValueError('El lookup de confirmación no es válido.')
    if not isinstance(max_age, timedelta) or max_age <= timedelta(0):
        raise ValueError('max_age debe ser un timedelta positivo.')

    def decide(claim, request_sha256: str) -> bool:
        try:
            if getattr(claim, 'kind', None) != 'google_generation':
                return False
            if not isinstance(request_sha256, str) or not _HASH.fullmatch(request_sha256):
                return False
            record = lookup.confirmed(claim, request_sha256)
            if not isinstance(record, GenerationConfirmation):
                return False
            if record.source != _CLIENT_SOURCE:
                return False
            if (record.user_id != getattr(claim, 'user_id', None)
                    or record.job_id != getattr(claim, 'job_id', None)
                    or record.request_sha256 != request_sha256):
                return False
            if (not isinstance(record.confirmed_at, datetime)
                    or record.confirmed_at.tzinfo is None):
                return False
            now = now_provider()
            if not isinstance(now, datetime) or now.tzinfo is None:
                return False
            # Vigencia: confirmada en el pasado reciente (ni futura ni caducada).
            if record.confirmed_at > now or now - record.confirmed_at > max_age:
                return False
            return True
        except Exception:
            # Fail-closed: cualquier excepción inesperada NO abre el gate.
            return False

    return decide

"""Núcleo seguro de la CONFIRMACIÓN POR GENERACIÓN: escritura (acto del cliente) + lookup del gate.

El `gate_decider` (creative_clips_only_gate) solo LEE; la seguridad real del gasto vive aquí, en la
ESCRITURA. Este módulo da la lógica pura; la ruta FastAPI (que extrae el usuario de la SESIÓN
autenticada) y el SQL (tabla de confirmaciones) son el envoltorio/cableado de interfaz-web, aparte.

INVARIANTES DE SEGURIDAD (lo que REA radiografía; vuelven al Consultor):
  * `source` se FIJA a 'client_explicit' aquí, nunca viene de la entrada → una confirmación de
    modelo/worker no existe por construcción.
  * `session_user_id` lo aporta la SESIÓN autenticada (la ruta lo pasa), JAMÁS el cuerpo del cliente:
    la confirmación se liga al usuario de la sesión, no a un user_id que el cliente mande a confianza.
  * ANTI-MUTACIÓN (integridad): `request_sha256` confirmado DEBE == el `request_sha256` aprobado del job
    (lo lee `reader.confirmable`); así el cliente solo puede confirmar la petición EXACTA que vio
    cotizada, y el gate solo abre para ESE sha (encaja con binding_sha256/request_sha256).
  * El job debe ser confirmable (del usuario, admitido/held, no despachado) — lo afirma el reader.
  * Fail-closed: cualquier forma/estado/mismatch ⇒ error y NO se escribe confirmación.
Doble cobro: cubierto por la idempotencia de reserve_once/129 (ya verificada); el «un solo uso» es
añadido opcional, no se exige aquí. Per-generación: una confirmación por request_sha256 (decisión del
dueño), disparada DESPUÉS de approve_composite_quote (que es el TECHO del trabajo).

STAGED + INERTE: funciones puras sobre puertos inyectados (reader/store/fetch); sin red/DB propias; sin
ruta montada. D-PROTECCIÓN: no registra tokens ni €; el € y la tarjeta los pone Frontend-app.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime
from typing import Callable, Protocol, runtime_checkable
from uuid import UUID

from .creative_clips_only_gate import GenerationConfirmation

_HASH = re.compile(r'[0-9a-f]{64}\Z')
# DEBE coincidir con `_CLIENT_SOURCE` del gate (un test lo pinea). Se fija aquí, no viene de la entrada.
CONFIRMATION_SOURCE = 'client_explicit'


class ClipsOnlyConfirmationError(Exception):
    """Fail-closed: no se pudo registrar/leer una confirmación de generación verificable."""


@dataclass(frozen=True)
class ConfirmableGeneration:
    """Lo que el reader afirma del job a confirmar (del usuario, admitido/held, su sha aprobado)."""
    user_id: str
    job_id: str
    request_sha256: str
    confirmable: bool


@runtime_checkable
class ConfirmableGenerationReader(Protocol):
    """Lee del estado persistido la generación confirmable que coincide con ESTE request_sha256.

    DESAMBIGUA por request_sha256 (fix de interfaz, multi-clip): un job puede tener VARIOS clips
    (varias operaciones google_generation, cada una con su request_sha256); el reader devuelve la que
    coincide con el `request_sha256` pedido, o None. Así cada clip es confirmable por separado."""

    def confirmable(self, c, *, user_id: str, job_id: str,
                    request_sha256: str) -> ConfirmableGeneration | None:
        ...


@runtime_checkable
class GenerationConfirmationStore(Protocol):
    """Persiste la confirmación en la transacción de la petición del cliente."""

    def record(self, c, confirmation: GenerationConfirmation) -> None:
        ...


def _uuid(value: object) -> bool:
    try:
        return str(UUID(str(value))) == value
    except (ValueError, TypeError, AttributeError):
        return False


def confirm_generation(c, *, reader: ConfirmableGenerationReader,
                       store: GenerationConfirmationStore, session_user_id: str,
                       job_id: str, request_sha256: str, now: datetime) -> GenerationConfirmation:
    """Registra la confirmación del cliente para una generación EXACTA. `session_user_id` viene de la
    SESIÓN autenticada (la ruta lo pasa), nunca del cuerpo. Fail-closed."""
    if not (callable(getattr(reader, 'confirmable', None))
            and callable(getattr(store, 'record', None))):
        raise ClipsOnlyConfirmationError('reader/store no válidos.')
    if not (_uuid(session_user_id) and _uuid(job_id)):
        raise ClipsOnlyConfirmationError('Identificadores de sesión/job no válidos.')
    if not isinstance(request_sha256, str) or not _HASH.fullmatch(request_sha256):
        raise ClipsOnlyConfirmationError('request_sha256 no válido.')
    if not isinstance(now, datetime) or now.tzinfo is None:
        raise ClipsOnlyConfirmationError('`now` debe ser datetime con zona horaria.')
    row = reader.confirmable(c, user_id=session_user_id, job_id=job_id,
                             request_sha256=request_sha256)
    if (not isinstance(row, ConfirmableGeneration) or not row.confirmable
            or row.user_id != session_user_id or row.job_id != job_id
            or row.request_sha256 != request_sha256):
        # ANTI-MUTACIÓN: el sha confirmado debe ser el aprobado del job del PROPIO usuario.
        raise ClipsOnlyConfirmationError(
            'El job no es confirmable o el sha no coincide con el aprobado.')
    confirmation = GenerationConfirmation(
        user_id=session_user_id, job_id=job_id, request_sha256=request_sha256,
        confirmed_at=now, source=CONFIRMATION_SOURCE)
    store.record(c, confirmation)
    return confirmation


class StoredGenerationConfirmationLookup:
    """`GenerationConfirmationLookup` (del gate) respaldado por un `fetch` inyectado. El gate_decider
    corre SIN conexión `c`, así que el `fetch` gestiona su propia lectura. Devuelve None si no hay."""

    def __init__(self, fetch: Callable[..., object]) -> None:
        if not callable(fetch):
            raise ClipsOnlyConfirmationError('fetch no es invocable.')
        self._fetch = fetch

    def confirmed(self, claim, request_sha256: str) -> GenerationConfirmation | None:
        record = self._fetch(
            user_id=getattr(claim, 'user_id', None),
            job_id=getattr(claim, 'job_id', None), request_sha256=request_sha256)
        return record if isinstance(record, GenerationConfirmation) else None

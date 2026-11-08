"""Mecanismo de admisión CLIPS-ONLY, staged+inert, con el ACTO DE AUTORIZACIÓN
DEL CLIENTE como SEAM inyectado («UX dueño»).

Compone los primitivos durables YA existentes (sin reimplementarlos):
`approve_composite_quote` y `hold_execution_graph` (creative_execution_ledger),
`admit_held_execution` (creative_execution_admission) y
`build_clips_only_execution_graph` (creative_execution_graph). NO crea rutas, NO
llama proveedores, NO despacha, NO migra: cada primitivo mantiene su propio
`dispatch_authorized=false`.

Dos verdades de diseño que este módulo respeta (no inventa):

1. La admisión NO es una sola transacción. Emitir la cotización, la autorización
   del cliente, retener el grafo y admitir son FRONTERAS DE PETICIÓN distintas
   (emitir → el cliente revisa → el cliente autoriza → retener → admitir). Por eso
   la autorización es un SEAM: el momento y la superficie los decide la UX del
   dueño (D-UX-OWNER-DEFINES); aquí solo se formaliza el contrato del acto.

2. El acto de autorización del cliente YA EXISTE como función durable:
   `approve_composite_quote(..., acknowledged=True)`. Este módulo NO lo reimplanta;
   expone un gate inyectable que, SOLO ante un acto real del cliente, lo invoca con
   los hashes EXACTOS de la cotización persistida. Sin UX enganchada el gate
   RECHAZA (fail-closed) → el mecanismo es inerte.

Fuera de alcance aquí (unidad distinta): la compuerta de gasto server-side (084
`reserve_once`/§125 `creative_estudio_spend`, separación card/token, una
autorización = un dispatch) — el `gate_decider`, que REA debe radiografiar antes
de cablear. Este módulo cubre la cara CLIENTE de la autorización (088), no la
compuerta de gasto.
"""

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol, runtime_checkable
from uuid import UUID

from .creative_composite_quote import CompositeQuoteReadiness
from .creative_execution_admission import (CreativeExecutionAdmissionReceipt,
                                          admit_held_execution)
from .creative_execution_graph import (ExecutionApprovalBinding,
                                       build_clips_only_execution_graph)
from .creative_execution_ledger import (approve_composite_quote,
                                       hold_execution_graph)


class ClipsOnlyAuthorizationError(Exception):
    """El acto de autorización del cliente no está disponible o fue denegado."""


@dataclass(frozen=True)
class ClipsOnlyAuthorizationRequest:
    """Lo que la UX del dueño DEBE confirmar para autorizar un clip.

    Son los campos EXACTOS que `approve_composite_quote` exige, tomados de la
    cotización YA persistida (su `_quote_view`). La UX decide la superficie y el
    momento del acto; NO decide estos valores.
    """
    quote_id: str
    request_id: str
    quote_sha256: str
    binding_sha256: str
    costs_snapshot_sha256: str
    max_total_usd: str


@runtime_checkable
class ClipsOnlyAuthorizationGate(Protocol):
    """SEAM «UX dueño»: ¿el cliente autorizó pagar ESTE clip exacto?

    La implementación real la provee la UX del dueño (D-UX-OWNER-DEFINES). Debe
    leer el acto REAL del cliente (no fabricable por modelo/worker), ligado a la
    cotización exacta, y tratar una autorización como un solo uso. Devuelve True
    SOLO ante un acto real; cualquier otra cosa es False.
    """

    def client_acknowledged(self,
                            request: ClipsOnlyAuthorizationRequest) -> bool: ...


class UnboundAuthorizationGate:
    """Default INERTE: sin UX enganchada, nada autoriza (fail-closed).

    Es el gate por defecto del mecanismo. Mientras la UX del dueño no exista, este
    gate garantiza que ninguna ruta pueda mintar una aprobación.
    """

    def client_acknowledged(self,
                            request: ClipsOnlyAuthorizationRequest) -> bool:
        return False


def hold_clips_only_graph(c, user: dict, request_id: UUID,
                          readiness: CompositeQuoteReadiness,
                          approval: ExecutionApprovalBinding, *,
                          now: datetime | None = None) -> dict:
    """Punto de decisión CLIPS-ONLY: construye el grafo SIN montaje y lo retiene.

    Única diferencia con el camino de montaje: usa
    `build_clips_only_execution_graph` (por operación `google_generation` →
    `storage_adopt` INTERNO; sin `craft`/`review`). Reusa `hold_execution_graph`
    tal cual (job `held`, `dispatch_authorized=false`); no añade invariantes.
    """
    graph = build_clips_only_execution_graph(readiness, approval)
    return hold_execution_graph(c, user, request_id, readiness, graph, now=now)


def authorize_clips_only_quote(c, user: dict, *,
                               gate: ClipsOnlyAuthorizationGate,
                               quote_view: dict, request_id: UUID,
                               now: datetime | None = None
                               ) -> ExecutionApprovalBinding:
    """Convierte el acto de autorización del cliente (SEAM) en la aprobación durable.

    El `gate` decide SÍ/NO leyendo el acto real del cliente. SOLO si autoriza se
    minta la aprobación con `acknowledged=True` y los hashes EXACTOS de la
    cotización persistida (`quote_view`, de `persist_composite_quote`). Con el gate
    por defecto (`UnboundAuthorizationGate`) esto SIEMPRE rechaza → inerte. No
    despacha ni llama proveedores: `approve_composite_quote` solo persiste la
    aprobación exacta.
    """
    request = ClipsOnlyAuthorizationRequest(
        quote_id=str(UUID(str(quote_view['quoteId']))),
        request_id=str(UUID(str(request_id))),
        quote_sha256=quote_view['quoteSha256'],
        binding_sha256=quote_view['bindingSha256'],
        costs_snapshot_sha256=quote_view['costsSnapshotSha256'],
        max_total_usd=str(quote_view['maxTotalUsd']))
    if gate.client_acknowledged(request) is not True:
        raise ClipsOnlyAuthorizationError(
            'La UX del dueño aún no ha autorizado este clip (seam sin enganchar).')
    return approve_composite_quote(
        c, user, UUID(request.quote_id), UUID(request.request_id),
        quote_sha256=request.quote_sha256,
        binding_sha256=request.binding_sha256,
        costs_snapshot_sha256=request.costs_snapshot_sha256,
        max_total_usd=request.max_total_usd, acknowledged=True, now=now)


def admit_clips_only_job(c, user: dict,
                         job_id: UUID) -> CreativeExecutionAdmissionReceipt:
    """Admite el job clips-only ya retenido (expone solo las raíces como `queued`).

    Reusa `admit_held_execution` tal cual: `dispatch_authorized` sigue en false y
    no se llama a ningún proveedor. En el grafo clips-only la raíz es el paso
    `google_generation`; `storage_adopt` queda `held` hasta que la generación
    termina.
    """
    return admit_held_execution(c, user, job_id)

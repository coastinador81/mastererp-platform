"""Cancelación recuperable de una interacción Omni ya aceptada.

El transporte usa como máximo un POST. Ante resultado incierto consulta el mismo
interactionId una vez y nunca repite la cancelación ni la generación original.
"""

from dataclasses import dataclass

import requests

from .creative_google_capabilities import ModelId
from .creative_composite_quote import canonical_sha256
from .creative_video_contracts import omni_recovery_request


_OMNI = ModelId.OMNI_11.value
_TERMINAL = frozenset({"cancelled", "completed", "failed", "incomplete"})


class OmniCancellationUnknown(Exception):
    """No hay evidencia suficiente para decidir si Omni quedó cancelado."""


@dataclass(frozen=True)
class OmniCancellationRequest:
    project: str
    interaction_id: str
    model: str
    method: str
    endpoint: str


@dataclass(frozen=True)
class OmniCancellationReceipt:
    snapshot: dict
    sha256: str


def omni_cancellation_request(
        project: str, interaction_id: str, *,
        model: str = _OMNI) -> OmniCancellationRequest:
    recovery = omni_recovery_request(project, interaction_id)
    if model != _OMNI:
        raise ValueError("Modelo Omni de cancelación no admitido.")
    return OmniCancellationRequest(
        project, interaction_id, model, "POST", recovery.endpoint + "/cancel")


def validate_omni_cancellation_request(
        request: OmniCancellationRequest) -> None:
    if not isinstance(request, OmniCancellationRequest):
        raise ValueError("Petición Omni de cancelación no válida.")
    rebuilt = omni_cancellation_request(
        request.project, request.interaction_id, model=request.model)
    if request != rebuilt:
        raise ValueError("Petición Omni de cancelación alterada.")


def _receipt(request: OmniCancellationRequest,
             payload: object) -> OmniCancellationReceipt:
    if not isinstance(payload, dict):
        raise OmniCancellationUnknown("Respuesta Omni de cancelación ilegible.")
    status, usage = payload.get("status"), payload.get("usage")
    if (payload.get("id") != request.interaction_id
            or payload.get("model") != request.model
            or status not in _TERMINAL | {"in_progress"}
            or (usage is not None and not isinstance(usage, dict))):
        raise OmniCancellationUnknown(
            "La respuesta no corresponde a la interacción Omni cancelada.")
    snapshot = {
        "schemaVersion": 1,
        "kind": "omni_cancellation_receipt",
        "interactionId": request.interaction_id,
        "model": request.model,
        "status": status,
        "terminal": status in _TERMINAL,
        "cancelled": status == "cancelled",
        "usage": usage,
        "publicationAuthorized": False,
    }
    return OmniCancellationReceipt(snapshot, canonical_sha256(snapshot))


def cancel_omni_once(
        request: OmniCancellationRequest, token: str,
        session: requests.Session) -> OmniCancellationReceipt:
    """Cancela una vez; una incertidumbre se reconcilia con un único GET."""
    validate_omni_cancellation_request(request)
    if not isinstance(token, str) or not token:
        raise ValueError("Autorización Google ausente.")
    headers = {"Authorization": "Bearer " + token}
    response = None
    uncertain = False
    try:
        response = session.request(
            "POST", request.endpoint, headers=headers, timeout=(10, 30))
        if response.status_code == 200:
            try:
                return _receipt(request, response.json())
            except (ValueError, requests.RequestException) as error:
                raise OmniCancellationUnknown(
                    "Respuesta Omni de cancelación ilegible.") from error
        uncertain = True
    except requests.RequestException:
        uncertain = True
    finally:
        if response is not None:
            response.close()
    if not uncertain:
        raise OmniCancellationUnknown("Cancelación Omni indeterminada.")
    recovery = omni_recovery_request(request.project, request.interaction_id)
    follow_up = None
    try:
        follow_up = session.request(
            recovery.method, recovery.endpoint, headers=headers,
            timeout=(10, 30))
        if follow_up.status_code != 200:
            raise OmniCancellationUnknown(
                "No se pudo reconciliar la cancelación Omni.")
        try:
            return _receipt(request, follow_up.json())
        except (ValueError, requests.RequestException) as error:
            raise OmniCancellationUnknown(
                "Respuesta Omni de reconciliación ilegible.") from error
    except requests.RequestException as error:
        raise OmniCancellationUnknown(
            "Reconciliación Omni interrumpida.") from error
    finally:
        if follow_up is not None:
            follow_up.close()

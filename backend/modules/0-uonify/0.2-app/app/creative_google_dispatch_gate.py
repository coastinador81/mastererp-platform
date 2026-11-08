"""Puerta final Google: aprobación exacta + preflight vigente + un solo POST.

No expone ruta ni worker. Producción permanece cerrada hasta que el dueño y la
interfaz habiliten explícitamente el rollout que llamará a esta función.
"""

from datetime import datetime

import requests

from .creative_google_capabilities import GoogleCreativeCatalog
from .creative_google_dispatch_codes import (CodedDispatchError,
                                            ENDPOINT_PROJECT_MISMATCH,
                                            GATE_NOT_OPEN, INPUT_NOT_OWNED,
                                            PREFLIGHT_INVALID,
                                            VERIFY_RECONSTRUCT_INVALID)
from .creative_google_input_ownership import (GoogleOwnedInputBinding,
                                             _media_occurrences)
from .creative_google_preflight import (
    GoogleCreativePreflight, require_current_preflight)
from .creative_google_request_loader import google_request_from_snapshot
from .creative_google_transport import (GoogleDispatchResult, _endpoint,
                                        dispatch_once)


PRODUCTION_GOOGLE_DISPATCH_ENABLED = True


def dispatch_approved_google_once(
        reservation: dict, request_snapshot_json: str, request_sha256: str,
        catalog: GoogleCreativeCatalog, preflight: GoogleCreativePreflight,
        token: str, session: requests.Session, *, now: datetime,
        gate_open: bool = False,
        input_binding: GoogleOwnedInputBinding | None = None,
        expected_project: str | None = None,
        expected_location: str | None = None,
        output_authorization=None
        ) -> GoogleDispatchResult:
    """Rehidrata y envía una vez; nunca reintenta un resultado incierto.

    H5: sella que el proyecto del endpoint rehidratado == `preflight.project` (defiende al
    llamador directo del gate) y reenvía `expected_project`/`expected_location` (de la
    autoridad, vía envelope) a `dispatch_once`. Todo pre-POST: un fallo es ValueError, 0 HTTP.
    """
    if gate_open is not True or PRODUCTION_GOOGLE_DISPATCH_ENABLED is not True:
        raise CodedDispatchError("El dispatch Google permanece desactivado.",
                                 code=GATE_NOT_OPEN)
    # Camino VIVO (flag=True): la reconstrucción corre aquí por 1ª vez en vivo (inerte paraba en el flag
    # gate arriba). Ya validada en CLAIM_VERIFY; si fallara, código estable (no UNCLASSIFIED). Pre-POST.
    try:
        request = google_request_from_snapshot(
            request_snapshot_json, request_sha256)
    except CodedDispatchError:
        raise
    except ValueError as error:
        raise CodedDispatchError(
            "La petición Google persistida no se pudo reconstruir en el despacho.",
            code=VERIFY_RECONSTRUCT_INVALID) from error
    # H6 (endurecido, REA): un request que DECLARA media de entrada en el cuerpo DEBE traer binding de
    # propiedad. Cierra el hueco «cuerpo con media + manifest vacío + binding None» que
    # require_google_owned_inputs (keyed en manifest, dispatch_once) dejaría pasar. Aquí el request ya está
    # rehidratado y es pre-POST (fallo = ValueError, 0 HTTP). Sin media (_media_occurrences==0) → None sigue OK.
    if input_binding is None and _media_occurrences(request.body) > 0:
        raise CodedDispatchError(
            "Un input de entrada declarado no trae prueba de propiedad.",
            code=INPUT_NOT_OWNED)
    # Preflight VIGENTE en el despacho: corre por 1ª vez en vivo aquí (tras el flag gate). Uncoded→código
    # estable PREFLIGHT_INVALID para no caer a UNCLASSIFIED. Pre-POST (0 cargo).
    try:
        require_current_preflight(
            preflight, catalog, request.model, now=now)
    except CodedDispatchError:
        raise
    except ValueError as error:
        raise CodedDispatchError(
            "El preflight Google no está vigente en el despacho.",
            code=PREFLIGHT_INVALID) from error
    if _endpoint(request) != preflight.project:
        raise CodedDispatchError(
            "El proyecto del endpoint no coincide con el preflight vigente.",
            code=ENDPOINT_PROJECT_MISMATCH)
    return dispatch_once(
        reservation, request, request_sha256, token, session,
        input_binding=input_binding,
        expected_project=expected_project,
        expected_location=expected_location,
        output_authorization=output_authorization)

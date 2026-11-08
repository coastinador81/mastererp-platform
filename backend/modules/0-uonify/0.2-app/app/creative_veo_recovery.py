"""Consulta una operación Veo ya aceptada; jamás inicia una generación."""

from dataclasses import dataclass
import re
import requests

from .creative_video_contracts import (VideoOutput, VideoUriOutput,
                                       operation_name_matches,
                                       operation_name_project_form,
                                       veo_completed, veo_recovery_request)
from .creative_veo_uri_outputs import veo_completed_uris


# H10: solo se consulta en una location autorizada (la misma que valida el authority);
# la del operation_name se deriva y se valida contra este conjunto, fail-closed.
_VEO_POLL_LOCATIONS = frozenset({'global', 'us-central1', 'europe-southwest1'})


def _operation_location(operation_name: object) -> str:
    """H10: deriva la location del operation_name y la valida contra el conjunto
    autorizado; nunca consulta una location arbitraria de un nombre malformado."""
    match = (re.search(r'/locations/([^/]+)/', operation_name)
             if isinstance(operation_name, str) else None)
    location = match.group(1) if match else None
    if location not in _VEO_POLL_LOCATIONS:
        raise ValueError('Location de la operación Veo no autorizada.')
    return location


@dataclass(frozen=True)
class VeoPoll:
    operation_name: str
    done: bool
    outputs: tuple[VideoOutput | VideoUriOutput, ...] = ()
    status: str = 'pending'
    # H11: motivos/códigos de un rechazo (RAI o error de la operación), para el journal.
    reasons: tuple[str, ...] = ()


class VeoRecoveryUnknown(Exception):
    """La consulta falló; no se debe enviar de nuevo la generación."""


class VeoRecoveryNotFound(VeoRecoveryUnknown):
    """H11: la operación Veo no existe (404/NOT_FOUND). Clase propia, distinguible de
    `VeoRecoveryUnknown` (subclase para no romper a quien capture Unknown); nunca se
    reenvía la generación."""


def _reason_tuple(*values) -> tuple[str, ...]:
    """Normaliza motivos/códigos a una tupla de cadenas no vacías."""
    out: list[str] = []
    for value in values:
        if isinstance(value, (list, tuple)):
            out.extend(str(item) for item in value
                       if isinstance(item, (str, int)) and str(item))
        elif isinstance(value, (str, int)) and str(value):
            out.append(str(value))
    return tuple(out)


def poll_veo_once(project: str, model: str, operation_name: str,
                  token: str, session: requests.Session,
                  expected_output_prefix: str | None = None) -> VeoPoll:
    """Una sola consulta fetchPredictOperation sin reintentos ni efecto creativo."""
    # H10: se consulta en la location del propio operation_name (derivada y autorizada),
    # no en una fija; el dispatch sigue us-central1-only, así que en la práctica es
    # us-central1, pero la operación se consulta en su location real.
    location = _operation_location(operation_name)
    request = veo_recovery_request(project, model, operation_name, location=location)
    if not isinstance(token, str) or not token:
        raise ValueError('Autorización Google ausente.')
    try:
        response = session.request(request.method, request.endpoint,
                                   headers={'Authorization': 'Bearer ' + token},
                                   json=request.body, timeout=(10, 30),
                                   allow_redirects=False)
    except requests.RequestException as error:
        network_error = type(error).__name__
    else:
        network_error = None
    if network_error is not None:
        # H4: no encadenar la RequestException (lleva el Bearer en .request);
        # se relanza fuera del except conservando solo el nombre de la clase.
        failure = VeoRecoveryUnknown('Consulta Veo interrumpida.')
        failure.cause_class = network_error
        failure.branch = 'network'
        raise failure from None
    try:
        if response.status_code == 404:
            # H11: 404/NOT_FOUND se clasifica aparte del resto de no-200.
            raise VeoRecoveryNotFound(
                'La operación Veo no existe (404 NOT_FOUND).')
        # F9 (observabilidad D-PROTECCIÓN-safe): cada VeoRecoveryUnknown lleva una ETIQUETA
        # de rama (`.branch`) y, en el no-200, el `.http_status` (int) — NUNCA URL/body/token/
        # operationName. El runner la vuelca en el reason del journal (`veo_poll_unknown:<rama>
        # [:http_<code>]`) para nombrar POR QUÉ falla un poll sin un traceback completo.
        if response.status_code != 200:
            failure = VeoRecoveryUnknown('No se pudo consultar la operación Veo.')
            failure.branch = 'http'
            failure.http_status = response.status_code
            raise failure
        try:
            payload = response.json()
        except (ValueError, requests.RequestException) as error:
            failure = VeoRecoveryUnknown('Respuesta Veo ilegible.')
            failure.branch = 'bad_json'
            raise failure from error
        if (not isinstance(payload, dict)
                or not operation_name_matches(payload.get('name'), operation_name)):
            # F9: tolera el eco project-id↔number (misma op); el discriminador lleva la FORMA del
            # proyecto (id/number/other) y si `done` estaba presente, sin exponer el valor.
            failure = VeoRecoveryUnknown(
                'La respuesta no corresponde a la operación Veo.')
            failure.branch = 'name_mismatch'
            failure.name_form = (
                operation_name_project_form(payload.get('name'), operation_name)
                if isinstance(payload, dict) else 'other')
            failure.done_present = isinstance(payload, dict) and 'done' in payload
            raise failure
        # F9: un LRO EN CURSO responde 200 con {"name": <op>} y, en proto3-JSON, OMITE
        # `done` cuando es false (es el default) → payload.get('done') es None, no False.
        # Tratar ausente/False/cualquier valor ≠ True como 'pending' (aún corriendo), no
        # como incierto: el guard de name-match (arriba) ya descarta una respuesta ajena.
        if payload.get('done') is not True:
            return VeoPoll(operation_name, False)
        error = payload.get('error')
        if isinstance(error, dict):
            # H11: llevar el código/estado del error al VeoPoll (y de ahí al journal).
            return VeoPoll(operation_name, True, (), 'failed',
                           _reason_tuple(error.get('status'), error.get('code')))
        # 12c: done:true con bloqueo RAI (raiMediaFilteredCount>0) y sin vídeos es un
        # rechazo determinista (failed), no un resultado incierto.
        resp = payload.get('response')
        if isinstance(resp, dict):
            filtered = resp.get('raiMediaFilteredCount')
            vids = resp.get('videos')
            if (isinstance(filtered, int) and filtered > 0
                    and (not isinstance(vids, list) or len(vids) == 0)):
                # H11: llevar raiMediaFilteredReasons al VeoPoll (y de ahí al journal).
                return VeoPoll(operation_name, True, (), 'failed',
                               _reason_tuple(resp.get('raiMediaFilteredReasons')))
        try:
            outputs = (veo_completed_uris(
                payload, operation_name, expected_output_prefix)
                if expected_output_prefix is not None
                else veo_completed(payload, operation_name))
        except ValueError as error:
            failure = VeoRecoveryUnknown(
                'La operación Veo terminó sin medios verificables.')
            failure.branch = 'output_invalid'
            raise failure from error
        return VeoPoll(operation_name, True, outputs, 'completed')
    finally:
        response.close()

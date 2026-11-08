"""Consulta de una interacción Omni durable ya registrada; nunca genera vídeo."""

from dataclasses import dataclass

import requests

from .creative_video_contracts import (VideoOutput, VideoUriOutput,
                                       omni_completed, omni_completed_uris,
                                       omni_recovery_request)


@dataclass(frozen=True)
class OmniPoll:
    interaction_id: str
    status: str
    outputs: tuple[VideoOutput | VideoUriOutput, ...] = ()


class OmniRecoveryUnknown(Exception):
    """La consulta no permite decidir; el trabajo original no se reenvía."""


def poll_omni_once(project: str, interaction_id: str, token: str,
                   session: requests.Session,
                   expected_output_prefix: str | None = None) -> OmniPoll:
    request = omni_recovery_request(project, interaction_id)
    if not isinstance(token, str) or not token:
        raise ValueError('Autorización Google ausente.')
    try:
        response = session.request(request.method, request.endpoint,
                                   headers={'Authorization': 'Bearer ' + token},
                                   timeout=(10, 30))
    except requests.RequestException as error:
        raise OmniRecoveryUnknown('Consulta Omni interrumpida; no repetir generación.') from error
    try:
        if response.status_code != 200:
            raise OmniRecoveryUnknown('No se pudo consultar la interacción Omni.')
        try:
            payload = response.json()
        except (ValueError, requests.RequestException) as error:
            raise OmniRecoveryUnknown('Respuesta Omni ilegible.') from error
        if (not isinstance(payload, dict)
                or payload.get('id') != interaction_id):
            raise OmniRecoveryUnknown(
                'La respuesta no corresponde a la interacción Omni.')
        status = payload.get('status')
        if status in ('queued', 'in_progress'):
            return OmniPoll(interaction_id, status)
        if status in ('failed', 'cancelled', 'incomplete'):
            return OmniPoll(interaction_id, status)
        if status != 'completed':
            raise OmniRecoveryUnknown('La interacción Omni terminó sin resultado verificable.')
        try:
            outputs = tuple(omni_completed_uris(payload, expected_output_prefix)
                            if expected_output_prefix is not None
                            else omni_completed(payload))
        except ValueError as error:
            raise OmniRecoveryUnknown('La interacción Omni no contiene vídeo verificable.') from error
        return OmniPoll(interaction_id, 'completed', outputs)
    finally:
        response.close()

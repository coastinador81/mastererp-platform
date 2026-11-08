"""Identidades durables para las peticiones cerradas por el draft creativo."""

from uuid import NAMESPACE_URL, uuid5

from .creative_composite_quote import RequestOperationBinding
from .creative_execution_draft import CreativeExecutionDraft
from .creative_image_direction import DirectedImagePlan
from .creative_request_fingerprint import fingerprint, request_snapshot_json
from .creative_video_direction import DirectedVideoBatch


def _operation(draft: CreativeExecutionDraft, ordinal: int, unit_id: str,
               kind: str, request) -> RequestOperationBinding:
    exact = fingerprint(request)
    identity = str(uuid5(
        NAMESPACE_URL,
        f'uonify:{draft.snapshot_sha256}:{ordinal}:{unit_id}:{kind}'))
    return RequestOperationBinding(identity, ordinal, unit_id, kind, exact.sha256,
                                   exact.model, exact.endpoint,
                                   request_snapshot_json(request))


def video_request_operations(draft: CreativeExecutionDraft,
                             directed: DirectedVideoBatch
                             ) -> tuple[RequestOperationBinding, ...]:
    if (not isinstance(draft, CreativeExecutionDraft) or draft.medium != 'vídeo'
            or not isinstance(directed, DirectedVideoBatch)
            or draft.request_group_sha256 == ''
            or len(directed.directions) != len(directed.batch.request_hashes)):
        raise ValueError('Draft o dirección de vídeo no válidos.')
    rows = [(direction.unitId, 'video_generation', request)
            for direction, request in zip(
                directed.directions, directed.batch.requests)]
    rows.extend((voice.unit_id, 'voiceover', voice.request)
                for voice in directed.voiceovers)
    hashes = tuple(fingerprint(item[2]).sha256 for item in rows)
    if (hashes != draft.request_hashes
            or draft.project != directed.batch.project
            or draft.model != directed.batch.model
            or draft.skill_version != directed.skill_version
            or draft.skill_source_sha256 != directed.skill_source_sha256):
        raise ValueError('Las operaciones no corresponden al draft cerrado.')
    return tuple(_operation(draft, index, unit_id, kind, request)
                 for index, (unit_id, kind, request) in enumerate(rows, 1))


def image_request_operations(draft: CreativeExecutionDraft,
                             directed: DirectedImagePlan
                             ) -> tuple[RequestOperationBinding, ...]:
    if (not isinstance(draft, CreativeExecutionDraft) or draft.medium != 'imagen'
            or not isinstance(directed, DirectedImagePlan)
            or draft.request_hashes != (directed.request_sha256,)
            or draft.model != directed.request.model
            or draft.skill_version != directed.skill_version
            or draft.skill_source_sha256 != directed.skill_source_sha256):
        raise ValueError('La operación de imagen no corresponde al draft cerrado.')
    return (_operation(draft, 1, directed.direction.unitId,
                       'image_generation', directed.request),)

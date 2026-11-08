"""Contrato de exportación opcional Transcoder para un master ya montado ≥5 s.

No crea jobs. FilmCraft puede entregar MP4 directamente; esta ruta solo se usa
cuando el cliente aprobó una salida adicional y el asset GCS es privado/verificado.
"""

from dataclasses import dataclass
from hashlib import sha256
import re
from uuid import UUID

from .creative_storage_contracts import StorageReceipt, storage_download_request
from .creative_video_contracts import mp4_duration_seconds


_PROJECT = re.compile(r'[a-z][a-z0-9-]{4,61}[a-z0-9]\Z')


@dataclass(frozen=True)
class TranscoderJobRequest:
    endpoint: str
    body: dict
    owner_id: str
    input_sha256: str
    input_generation: int
    duration_seconds: float
    output_prefix: str
    expected_filename: str = 'final-hd.mp4'
    approval_ready: bool = False


@dataclass(frozen=True)
class TranscoderRecoveryRequest:
    method: str
    endpoint: str


def _uuid(value: object, label: str) -> str:
    try:
        parsed = str(UUID(str(value)))
    except (ValueError, TypeError, AttributeError) as error:
        raise ValueError(f'{label} no válido.') from error
    if parsed != value:
        raise ValueError(f'{label} no canónico.')
    return parsed


def _owned_master(receipt: StorageReceipt, owner_id: str) -> None:
    if not isinstance(receipt, StorageReceipt):
        raise ValueError('Master MP4 almacenado no verificable.')
    prefix = f'creative/users/{owner_id}/assets/'
    if (not isinstance(receipt.name, str) or not receipt.name.startswith(prefix)
            or not isinstance(receipt.sha256, str)
            or not re.fullmatch(r'[0-9a-f]{64}', receipt.sha256)):
        raise ValueError('El master no pertenece a la biblioteca indicada.')
    tail = receipt.name[len(prefix):].split('/')
    if len(tail) != 2:
        raise ValueError('El master no pertenece a la biblioteca indicada.')
    try:
        asset_id = _uuid(tail[0], 'Asset del master')
    except ValueError:
        raise ValueError(
            'El master no pertenece a la biblioteca indicada.') from None
    if asset_id != tail[0] or tail[1] != f'{receipt.sha256}.mp4':
        raise ValueError('El master no pertenece a la biblioteca indicada.')


def transcode_hd_request(project: str, owner_id: str,
                         receipt: StorageReceipt, master_mp4: bytes,
                         export_id: str) -> TranscoderJobRequest:
    """Configura una sola salida H.264/AAC HD en europe-west1."""
    if not isinstance(project, str) or not _PROJECT.fullmatch(project):
        raise ValueError('Proyecto Google no válido.')
    owner_id = _uuid(owner_id, 'Propietario')
    _owned_master(receipt, owner_id)
    if (not isinstance(receipt, StorageReceipt) or receipt.mime_type != 'video/mp4'
            or not isinstance(master_mp4, bytes)
            or len(master_mp4) != receipt.byte_size
            or sha256(master_mp4).hexdigest() != receipt.sha256
            or receipt.generation <= 0):
        raise ValueError('Master MP4 almacenado no verificable.')
    storage_download_request(receipt)
    duration = mp4_duration_seconds(master_mp4)
    if duration < 5:
        raise ValueError('Transcoder requiere entrada de al menos 5 segundos.')
    export_id = _uuid(export_id, 'Identificador de exportación')
    input_uri = f'gs://{receipt.bucket}/{receipt.name}'
    output_prefix = (f'gs://{receipt.bucket}/creative/users/{owner_id}/'
                     f'exports/{export_id}/')
    config = {
        'inputs': [{'key': 'input0', 'uri': input_uri}],
        'output': {'uri': output_prefix},
        'elementaryStreams': [
            {'key': 'video0', 'videoStream': {'h264': {
                'widthPixels': 1280, 'heightPixels': 720,
                'frameRate': 30, 'bitrateBps': 2500000}}},
            {'key': 'audio0', 'audioStream': {'codec': 'aac',
                                              'bitrateBps': 128000}},
        ],
        'muxStreams': [{'key': 'final', 'fileName': 'final-hd.mp4',
                        'container': 'mp4',
                        'elementaryStreams': ['video0', 'audio0']}],
    }
    endpoint = (f'https://transcoder.googleapis.com/v1/projects/{project}'
                '/locations/europe-west1/jobs')
    return TranscoderJobRequest(
        endpoint, {'config': config}, owner_id, receipt.sha256,
        receipt.generation, duration, output_prefix)


def transcoder_job_name(project: str, response: dict,
                        project_number: str | None = None) -> str:
    """Vincula el job remoto al proyecto/región esperados para futuras consultas.

    Condición 9: Google devuelve el `name` con el project_id O con el
    project_number (ambos ligados al MISMO proyecto; el number se resuelve y se
    fija en la configuración/preflight, nunca se adivina). Se acepta cualquiera de
    los dos y se valida región (europe-west1) y sufijo (id del job).
    """
    if not isinstance(project, str) or not _PROJECT.fullmatch(project):
        raise ValueError('Proyecto Google no válido.')
    if (project_number is not None
            and not re.fullmatch(r'[0-9]{1,30}', project_number)):
        raise ValueError('Número de proyecto Google no válido.')
    name = response.get('name') if isinstance(response, dict) else None
    if not isinstance(name, str):
        raise ValueError('Job Transcoder ajeno o no válido.')
    identifiers = [project] + ([project_number] if project_number else [])
    for ident in identifiers:
        prefix = f'projects/{ident}/locations/europe-west1/jobs/'
        if (name.startswith(prefix)
                and re.fullmatch(r'[A-Za-z0-9_-]+', name[len(prefix):])):
            return name
    raise ValueError('Job Transcoder ajeno o no válido.')


def transcoder_recovery_request(
        project: str, job_name: str,
        project_number: str | None = None) -> TranscoderRecoveryRequest:
    """Consulta exactamente un job ya aceptado; nunca crea otro."""
    exact = transcoder_job_name(project, {'name': job_name}, project_number)
    return TranscoderRecoveryRequest(
        'GET', f'https://transcoder.googleapis.com/v1/{exact}')

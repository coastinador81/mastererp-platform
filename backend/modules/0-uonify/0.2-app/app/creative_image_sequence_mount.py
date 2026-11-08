"""Bounded, atomic materialization of a verified Effect PNG bundle."""

from dataclasses import asdict, dataclass
import ctypes
import errno
from hashlib import sha256
from io import BytesIO
import json
import os
from pathlib import Path, PurePosixPath
import shutil
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from typing import BinaryIO
from uuid import UUID, uuid4
from zipfile import ZIP_STORED, ZipFile

from .craft_contracts import CRAFT_CONTAINER_INPUT_ROOT, canonical_sha256
from .creative_effect_frame_bundle import (FILE_MODE, FORMAT, MANIFEST,
                                            ZIP_TIME)
from .creative_png_validation import validate_png as _validate_png

MOUNT_MANIFEST = '.uonify-image-sequence.json'


@dataclass(frozen=True)
class ImageSequenceMountReceipt:
    schema_version: int
    asset_id: str
    asset_revision: int
    snapshot_sha256: str
    bundle_generation: int
    bundle_sha256: str
    manifest_sha256: str
    bundle_plan_sha256: str
    worker_id: str
    lease_token: str
    input_root: str
    container_input_root: str
    mount_name: str
    first_frame_relative_path: str
    first_frame_sha256: str
    frame_count: int
    unpacked_bytes: int
    receipt_sha256: str


def _body(receipt: ImageSequenceMountReceipt) -> dict:
    value = asdict(receipt)
    value.pop('receipt_sha256')
    return value


def _safe_relative(value: object) -> str:
    if not isinstance(value, str) or not value or '\\' in value:
        raise ValueError('Una ruta del bundle no es segura.')
    path = PurePosixPath(value)
    if (path.is_absolute() or any(part in ('', '.', '..') for part in path.parts)
            or len(value) > 240):
        raise ValueError('Una ruta del bundle no es segura.')
    return value


def _snapshot_shape(snapshot) -> None:
    media = getattr(snapshot, 'media', None)
    receipt = getattr(snapshot, 'storage_receipt', None)
    blockers = getattr(snapshot, 'craft_blockers', ())
    if (getattr(snapshot, 'kind', None) != 'image_sequence'
            or getattr(snapshot, 'mime_type', None) != 'application/zip'
            or not isinstance(media, dict) or receipt is None
            or blockers != ('image_sequence_unpack_not_implemented',)
            or receipt.sha256 != snapshot.sha256
            or receipt.byte_size != snapshot.byte_size
            or receipt.mime_type != snapshot.mime_type
            or receipt.generation < 1):
        raise ValueError('El asset no es un bundle Effect autorizado para montaje.')


def _worker(value: object) -> str:
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > 160:
        raise ValueError('La identidad del worker de secuencia no es válida.')
    return value.strip()


def _lease(value: object) -> str:
    try:
        parsed = str(UUID(str(value)))
    except (TypeError, ValueError, AttributeError):
        raise ValueError('El lease del mount de secuencia no es válido.') from None
    return parsed


def validate_image_sequence_mount(snapshot,
                                  receipt: ImageSequenceMountReceipt) -> dict:
    """Validate a persisted receipt against the exact immutable asset."""
    _snapshot_shape(snapshot)
    if not isinstance(receipt, ImageSequenceMountReceipt):
        raise ValueError('Falta el recibo de montaje de la secuencia.')
    media = snapshot.media
    lease = _lease(receipt.lease_token)
    expected_mount = (f'{snapshot.asset_id}-r{snapshot.revision}-sequence-'
                      f'{lease}')
    root = Path(receipt.input_root)
    if (receipt.schema_version != 1 or receipt.asset_id != snapshot.asset_id
            or receipt.asset_revision != snapshot.revision
            or receipt.snapshot_sha256 != snapshot.snapshot_sha256
            or receipt.bundle_generation != snapshot.storage_receipt.generation
            or receipt.bundle_sha256 != snapshot.sha256
            or receipt.manifest_sha256 != media.get('manifestSha256')
            or receipt.bundle_plan_sha256 != media.get('bundlePlanSha256')
            or receipt.worker_id != _worker(receipt.worker_id)
            or receipt.lease_token != lease or not root.is_absolute()
            or receipt.container_input_root != CRAFT_CONTAINER_INPUT_ROOT
            or receipt.mount_name != expected_mount
            or _safe_relative(receipt.first_frame_relative_path)
            != receipt.first_frame_relative_path
            or not isinstance(receipt.first_frame_sha256, str)
            or len(receipt.first_frame_sha256) != 64
            or receipt.frame_count != media.get('frameCount')
            or receipt.unpacked_bytes < receipt.frame_count
            or canonical_sha256(_body(receipt)) != receipt.receipt_sha256):
        raise ValueError('El recibo de montaje no coincide con el bundle persistido.')
    return {
        'schemaVersion': 1, 'kind': 'image_sequence',
        'assetId': receipt.asset_id, 'assetRevision': receipt.asset_revision,
        'snapshotSha256': receipt.snapshot_sha256,
        'workerId': receipt.worker_id, 'leaseToken': receipt.lease_token,
        'inputRoot': receipt.input_root,
        'containerInputRoot': receipt.container_input_root,
        'mountName': receipt.mount_name,
        'firstFrameRelativePath': receipt.first_frame_relative_path,
        'firstFrameSha256': receipt.first_frame_sha256,
        'frameCount': receipt.frame_count,
        'unpackedBytes': receipt.unpacked_bytes,
        'bundleGeneration': receipt.bundle_generation,
        'bundleSha256': receipt.bundle_sha256,
        'manifestSha256': receipt.manifest_sha256,
        'bundlePlanSha256': receipt.bundle_plan_sha256,
        'receiptSha256': receipt.receipt_sha256,
    }


def image_sequence_mount_receipt(value: dict) -> ImageSequenceMountReceipt:
    fields = {
        'schemaVersion': 'schema_version', 'assetId': 'asset_id',
        'assetRevision': 'asset_revision', 'snapshotSha256': 'snapshot_sha256',
        'bundleGeneration': 'bundle_generation', 'bundleSha256': 'bundle_sha256',
        'manifestSha256': 'manifest_sha256',
        'bundlePlanSha256': 'bundle_plan_sha256', 'mountName': 'mount_name',
        'workerId': 'worker_id', 'leaseToken': 'lease_token',
        'inputRoot': 'input_root',
        'containerInputRoot': 'container_input_root',
        'firstFrameRelativePath': 'first_frame_relative_path',
        'firstFrameSha256': 'first_frame_sha256', 'frameCount': 'frame_count',
        'unpackedBytes': 'unpacked_bytes', 'receiptSha256': 'receipt_sha256',
    }
    if not isinstance(value, dict) or set(value) != set(fields):
        raise ValueError('El recibo de montaje no tiene forma canónica.')
    return ImageSequenceMountReceipt(**{target: value[source]
                                        for source, target in fields.items()})


def image_sequence_mount_payload(receipt: ImageSequenceMountReceipt) -> dict:
    if not isinstance(receipt, ImageSequenceMountReceipt):
        raise ValueError('Falta el recibo de montaje de la secuencia.')
    return {
        'schemaVersion': receipt.schema_version, 'assetId': receipt.asset_id,
        'assetRevision': receipt.asset_revision,
        'snapshotSha256': receipt.snapshot_sha256,
        'workerId': receipt.worker_id, 'leaseToken': receipt.lease_token,
        'inputRoot': receipt.input_root,
        'containerInputRoot': receipt.container_input_root,
        'bundleGeneration': receipt.bundle_generation,
        'bundleSha256': receipt.bundle_sha256,
        'manifestSha256': receipt.manifest_sha256,
        'bundlePlanSha256': receipt.bundle_plan_sha256,
        'mountName': receipt.mount_name,
        'firstFrameRelativePath': receipt.first_frame_relative_path,
        'firstFrameSha256': receipt.first_frame_sha256,
        'frameCount': receipt.frame_count,
        'unpackedBytes': receipt.unpacked_bytes,
        'receiptSha256': receipt.receipt_sha256,
    }


def _manifest_entries(manifest: object, snapshot,
                      max_unpacked_bytes: int) -> tuple[list[dict], int]:
    if not isinstance(manifest, dict):
        raise ValueError('El manifest del bundle no es canónico.')
    media = snapshot.media
    canvas, entries = manifest.get('canvas'), manifest.get('entries')
    rate = media.get('frameRate')
    expected_canvas = {
        'widthPixels': media.get('widthPixels'),
        'heightPixels': media.get('heightPixels'),
        'colorSpace': 'srgb',
        'transparent': bool(media.get('hasAlpha')),
        'frameRate': rate,
        'durationFrames': media.get('frameCount'),
    }
    if (set(manifest) != {'schemaVersion', 'format', 'canvas', 'frameCount',
                          'relativePattern', 'entries'}
            or manifest.get('schemaVersion') != 1 or manifest.get('format') != FORMAT
            or canonical_sha256(manifest) != media.get('manifestSha256')
            or canvas != expected_canvas
            or manifest.get('frameCount') != media.get('frameCount')
            or not isinstance(entries, list) or len(entries) != media.get('frameCount')
            or not isinstance(manifest.get('relativePattern'), str)
            or manifest['relativePattern'].count('%05d') != 1):
        raise ValueError('El manifest no coincide con el snapshot de la secuencia.')
    total = 0
    for ordinal, item in enumerate(entries):
        expected_path = manifest['relativePattern'].replace('%05d', f'{ordinal:05d}')
        if (not isinstance(item, dict)
                or set(item) != {'ordinal', 'relativePath', 'byteSize', 'sha256'}
                or item.get('ordinal') != ordinal
                or _safe_relative(item.get('relativePath')) != expected_path
                or not isinstance(item.get('byteSize'), int)
                or isinstance(item.get('byteSize'), bool) or item['byteSize'] < 8
                or not isinstance(item.get('sha256'), str)
                or len(item['sha256']) != 64):
            raise ValueError('Un frame no coincide con el manifest ordenado.')
        total += item['byteSize']
        if total > max_unpacked_bytes:
            raise ValueError('La secuencia supera el límite de bytes desempaquetados.')
    return entries, total


def _read_manifest(archive: ZipFile, snapshot, max_unpacked_bytes: int) -> tuple:
    infos = archive.infolist()
    if not infos or infos[0].filename != MANIFEST or infos[0].file_size > 1024**2:
        raise ValueError('El bundle no contiene un manifest acotado.')
    try:
        manifest = json.loads(archive.read(MANIFEST))
    except (UnicodeDecodeError, json.JSONDecodeError, KeyError):
        raise ValueError('El manifest del bundle no es JSON canónico.') from None
    entries, total = _manifest_entries(manifest, snapshot, max_unpacked_bytes)
    names = [MANIFEST] + [item['relativePath'] for item in entries]
    if [item.filename for item in infos] != names:
        raise ValueError('El ZIP contiene entradas inesperadas o desordenadas.')
    if any(item.compress_type != ZIP_STORED or item.date_time != ZIP_TIME
           or item.extra or item.comment or item.external_attr != FILE_MODE
           for item in infos):
        raise ValueError('El ZIP no conserva el formato determinista aprobado.')
    return manifest, entries, total


def inspect_image_sequence_bytes(media: dict, payload: bytes, *,
                                 expected_sha256: str,
                                 chunk_bytes: int = 1024 * 1024) -> dict:
    """Decode every frame from exact bundle bytes without creating authority."""
    if (not isinstance(media, dict) or not isinstance(payload, bytes)
            or sha256(payload).hexdigest() != expected_sha256
            or not isinstance(chunk_bytes, int) or isinstance(chunk_bytes, bool)
            or not 65536 <= chunk_bytes <= 8 * 1024**2):
        raise ValueError('Los bytes de inspección no coinciden con el bundle.')
    proxy = SimpleNamespace(media=media)
    with ZipFile(BytesIO(payload), 'r') as archive:
        _, entries, unpacked = _read_manifest(archive, proxy, len(payload))
        with TemporaryDirectory(prefix='uonify-inspect-') as folder:
            root = Path(folder)
            for ordinal, item in enumerate(entries):
                target = root / f'{ordinal:05d}.png'
                digest, size = sha256(), 0
                with (archive.open(item['relativePath'], 'r') as source,
                      target.open('xb') as sink):
                    while chunk := source.read(chunk_bytes):
                        digest.update(chunk)
                        size += len(chunk)
                        if size > item['byteSize']:
                            raise ValueError('Un frame inspeccionado supera su manifest.')
                        sink.write(chunk)
                if (size != item['byteSize']
                        or digest.hexdigest() != item['sha256']):
                    raise ValueError('Un frame inspeccionado no coincide.')
                _validate_png(
                    target, media['widthPixels'], media['heightPixels'],
                    bool(media.get('hasAlpha')), chunk_bytes)
    return {
        'decoder': 'uonify.strict-png-sequence-v1',
        'decodedFrames': len(entries), 'unpackedBytes': unpacked,
        'widthPixels': media['widthPixels'],
        'heightPixels': media['heightPixels'],
        'frameCount': media['frameCount'],
        'frameRate': media['frameRate'],
        'durationSeconds': media['durationSeconds'],
        'manifestSha256': media['manifestSha256'],
        'bundlePlanSha256': media['bundlePlanSha256'],
        'hasAlpha': bool(media.get('hasAlpha')),
    }


def _publish_no_replace(source: Path, target: Path) -> None:
    function = getattr(ctypes.CDLL(None, use_errno=True), 'renameat2', None)
    if function is None:
        raise ValueError('La plataforma no ofrece publicación atómica no-replace.')
    function.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int,
                         ctypes.c_char_p, ctypes.c_uint]
    function.restype = ctypes.c_int
    if function(-100, os.fsencode(source), -100, os.fsencode(target), 1) != 0:
        code = ctypes.get_errno()
        if code == errno.EEXIST:
            raise FileExistsError('El mount de secuencia apareció durante el publish.')
        raise OSError(code, os.strerror(code), str(target))


def verify_image_sequence_mount_files(
        snapshot, receipt: ImageSequenceMountReceipt, *,
        chunk_bytes: int = 1024 * 1024) -> dict:
    """Re-read the complete mount immediately before Craft authority binds."""
    payload = validate_image_sequence_mount(snapshot, receipt)
    if (not isinstance(chunk_bytes, int) or isinstance(chunk_bytes, bool)
            or not 65536 <= chunk_bytes <= 8 * 1024**2):
        raise ValueError('El límite de lectura del mount no es válido.')
    root = Path(receipt.input_root)
    if root.is_symlink() or not root.is_dir():
        raise ValueError('La raíz del mount ya no está disponible.')
    root = root.resolve(strict=True)
    target = root / receipt.mount_name
    if (target.is_symlink() or not target.is_dir()
            or target.resolve(strict=True).parent != root):
        raise ValueError('El mount físico ya no corresponde al recibo.')
    marker = target / MOUNT_MANIFEST
    if marker.is_symlink() or not marker.is_file() or marker.stat().st_size > 1024**2:
        raise ValueError('El mount perdió su manifest verificado.')
    try:
        manifest = json.loads(marker.read_text())
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise ValueError('El mount perdió su manifest verificado.') from None
    entries, total = _manifest_entries(manifest, snapshot, receipt.unpacked_bytes)
    if total != receipt.unpacked_bytes:
        raise ValueError('El mount físico cambió de tamaño.')
    expected = {MOUNT_MANIFEST, *(item['relativePath'] for item in entries)}
    observed = set()
    for path in target.rglob('*'):
        if path.is_symlink():
            raise ValueError('El mount físico contiene un enlace no autorizado.')
        if path.is_file():
            observed.add(path.relative_to(target).as_posix())
    if observed != expected:
        raise ValueError('El mount físico contiene ficheros inesperados o ausentes.')
    for item in entries:
        path = target.joinpath(*PurePosixPath(item['relativePath']).parts)
        digest, size = sha256(), 0
        with path.open('rb') as source:
            while chunk := source.read(chunk_bytes):
                digest.update(chunk)
                size += len(chunk)
                if size > item['byteSize']:
                    raise ValueError('Un frame montado supera el manifest.')
        if size != item['byteSize'] or digest.hexdigest() != item['sha256']:
            raise ValueError('Un frame montado cambió después del unpack.')
        _validate_png(path, snapshot.media['widthPixels'],
                      snapshot.media['heightPixels'], snapshot.media['hasAlpha'],
                      chunk_bytes)
    return payload


def cleanup_image_sequence_mount(snapshot,
                                 receipt: ImageSequenceMountReceipt) -> bool:
    """Remove only the direct mount named by a valid receipt after a failed attempt."""
    validate_image_sequence_mount(snapshot, receipt)
    root = Path(receipt.input_root)
    if root.is_symlink() or not root.is_dir():
        return False
    root = root.resolve(strict=True)
    target = root / receipt.mount_name
    if not target.exists():
        return False
    if (target.is_symlink() or not target.is_dir()
            or target.resolve(strict=True).parent != root):
        raise ValueError('El cleanup no puede borrar un mount ambiguo.')
    shutil.rmtree(target)
    return True


def _verify_bundle(source: BinaryIO, snapshot, chunk_bytes: int) -> None:
    source.seek(0)
    digest, size = sha256(), 0
    while chunk := source.read(chunk_bytes):
        digest.update(chunk)
        size += len(chunk)
        if size > snapshot.byte_size:
            raise ValueError('El bundle descargado supera el tamaño persistido.')
    if size != snapshot.byte_size or digest.hexdigest() != snapshot.sha256:
        raise ValueError('El bundle descargado no coincide con la generación persistida.')


def materialize_image_sequence(snapshot, source: BinaryIO, inputs_root: Path, *,
                               worker_id: str, lease_token: str,
                               max_unpacked_bytes: int,
                               chunk_bytes: int = 1024 * 1024
                               ) -> ImageSequenceMountReceipt:
    """Verify and atomically unpack one sequence under a worker input root."""
    _snapshot_shape(snapshot)
    if (not source.seekable() or not source.readable()
            or not isinstance(max_unpacked_bytes, int)
            or isinstance(max_unpacked_bytes, bool)
            or not 1 <= max_unpacked_bytes <= 2 * 1024**3
            or not isinstance(chunk_bytes, int) or isinstance(chunk_bytes, bool)
            or not 65536 <= chunk_bytes <= 8 * 1024**2):
        raise ValueError('Los límites de montaje de la secuencia no son válidos.')
    root = Path(inputs_root)
    if root.is_symlink() or not root.is_dir():
        raise ValueError('La raíz privada de inputs no es válida.')
    root = root.resolve(strict=True)
    worker, lease = _worker(worker_id), _lease(lease_token)
    mount_name = (f'{snapshot.asset_id}-r{snapshot.revision}-sequence-'
                  f'{lease}')
    target = root / mount_name
    if target.exists() or target.is_symlink():
        raise ValueError('El mount de secuencia ya existe y no puede sobrescribirse.')
    temporary = root / f'.{mount_name}.tmp-{uuid4()}'
    _verify_bundle(source, snapshot, chunk_bytes)
    source.seek(0)
    try:
        temporary.mkdir(mode=0o700)
        with ZipFile(source, 'r') as archive:
            manifest, entries, total = _read_manifest(
                archive, snapshot, max_unpacked_bytes)
            for item in entries:
                relative = PurePosixPath(item['relativePath'])
                destination = temporary.joinpath(*relative.parts)
                destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                digest, size, signature = sha256(), 0, b''
                flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
                if hasattr(os, 'O_NOFOLLOW'):
                    flags |= os.O_NOFOLLOW
                descriptor = os.open(destination, flags, 0o600)
                try:
                    with archive.open(item['relativePath']) as member, os.fdopen(
                            descriptor, 'wb', closefd=True) as output:
                        descriptor = -1
                        while chunk := member.read(chunk_bytes):
                            if len(signature) < 8:
                                signature += chunk[:8 - len(signature)]
                            output.write(chunk)
                            digest.update(chunk)
                            size += len(chunk)
                            if size > item['byteSize']:
                                raise ValueError('Un frame supera su tamaño declarado.')
                finally:
                    if descriptor >= 0:
                        os.close(descriptor)
                if (signature != b'\x89PNG\r\n\x1a\n'
                        or size != item['byteSize']
                        or digest.hexdigest() != item['sha256']):
                    raise ValueError('Un frame extraído no coincide con el manifest.')
                _validate_png(
                    destination, snapshot.media['widthPixels'],
                    snapshot.media['heightPixels'], snapshot.media['hasAlpha'],
                    chunk_bytes)
        marker = temporary / MOUNT_MANIFEST
        marker.write_text(json.dumps(
            manifest, ensure_ascii=False, sort_keys=True,
            separators=(',', ':'), allow_nan=False))
        marker.chmod(0o600)
        first = entries[0]
        provisional = ImageSequenceMountReceipt(
            1, snapshot.asset_id, snapshot.revision, snapshot.snapshot_sha256,
            snapshot.storage_receipt.generation, snapshot.sha256,
            snapshot.media['manifestSha256'], snapshot.media['bundlePlanSha256'],
            worker, lease, str(root), CRAFT_CONTAINER_INPUT_ROOT,
            mount_name, first['relativePath'],
            first['sha256'], len(entries), total, '')
        receipt = ImageSequenceMountReceipt(
            **{**provisional.__dict__, 'receipt_sha256': canonical_sha256(
                _body(provisional))})
        validate_image_sequence_mount(snapshot, receipt)
        _publish_no_replace(temporary, target)
    except Exception:
        shutil.rmtree(temporary, ignore_errors=True)
        raise
    return receipt

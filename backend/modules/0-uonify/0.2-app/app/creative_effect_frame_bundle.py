"""Canonical, deterministic packaging contract for EffectCraft PNG sequences."""

from dataclasses import dataclass
from base64 import b64encode
from hashlib import md5, sha256
from io import BytesIO
import json
from typing import BinaryIO, Mapping
from zipfile import ZIP_STORED, ZipFile, ZipInfo

from .craft_contracts import (CraftAdapterPlan, ResolvedCraftJob,
                              canonical_sha256, resolved_job_binding_sha256)


FORMAT = 'uonify.effect-frame-bundle.v1'
MANIFEST = 'manifest.json'
ARCHIVE_PATH = 'out/effectcraft/frame-bundle.zip'
ZIP_TIME = (1980, 1, 1, 0, 0, 0)
FILE_MODE = 0o100644 << 16


@dataclass(frozen=True)
class EffectFrameBundlePlan:
    schema_version: int
    job_id: str
    job_binding_sha256: str
    recipe_sha256: str
    input_manifest_sha256: str
    adapter_plan_sha256: str
    output_manifest_sha256: str
    archive_relative_path: str
    frame_count: int
    manifest: dict
    manifest_sha256: str
    uncompressed_bytes: int
    max_archive_bytes: int
    plan_sha256: str


@dataclass(frozen=True)
class EffectFrameBundleReceipt:
    schema_version: int
    archive_relative_path: str
    mime_type: str
    byte_size: int
    sha256: str
    frame_count: int
    manifest_sha256: str
    plan_sha256: str
    md5_base64: str
    publication_authorized: bool = False


def _plan_body(plan: EffectFrameBundlePlan) -> dict:
    return {
        'schemaVersion': plan.schema_version, 'format': FORMAT,
        'jobId': plan.job_id, 'jobBindingSha256': plan.job_binding_sha256,
        'recipeSha256': plan.recipe_sha256,
        'inputManifestSha256': plan.input_manifest_sha256,
        'adapterPlanSha256': plan.adapter_plan_sha256,
        'outputManifestSha256': plan.output_manifest_sha256,
        'archiveRelativePath': plan.archive_relative_path,
        'archive': {'format': 'zip', 'compression': 'stored',
                    'entryTimestamp': '1980-01-01T00:00:00Z',
                    'unixFileMode': '100644', 'manifestEntry': MANIFEST},
        'frameCount': plan.frame_count,
        'manifestSha256': plan.manifest_sha256,
        'uncompressedBytes': plan.uncompressed_bytes,
        'maxArchiveBytes': plan.max_archive_bytes,
    }


def build_effect_frame_bundle_plan(
        job: ResolvedCraftJob, adapter: CraftAdapterPlan,
        candidate: dict) -> EffectFrameBundlePlan:
    if (job.engine.name != 'effectcraft' or job.operation != 'motion_graphics'
            or adapter.job_id != job.job_id
            or adapter.job_binding_sha256 != resolved_job_binding_sha256(job)
            or candidate.get('jobId') != job.job_id
            or candidate.get('jobBindingSha256') != adapter.job_binding_sha256
            or candidate.get('adapterPlanSha256') != adapter.plan_sha256
            or candidate.get('inputManifestSha256') != job.input_manifest_sha256):
        raise ValueError('La secuencia no pertenece al job EffectCraft ligado.')
    recipe = job.plan.snapshot.get('recipe', {})
    output = recipe.get('output', {}) if isinstance(recipe, dict) else {}
    frames = candidate.get('outputs')
    count = output.get('frameCount')
    pattern = output.get('relativePattern')
    if (candidate.get('recipeSha256') != canonical_sha256(recipe)
            or candidate.get('outputManifestSha256')
            != canonical_sha256(candidate.get('outputs'))
            or not isinstance(frames, list) or not isinstance(count, int) or count < 1
            or len(frames) != count or not isinstance(pattern, str)):
        raise ValueError('La secuencia EffectCraft no está completa.')
    entries = []
    total = 0
    for ordinal, frame in enumerate(frames):
        path = pattern.replace('%05d', f'{ordinal:05d}')
        media = frame.get('media') if isinstance(frame, dict) else None
        if (not isinstance(frame, dict) or frame.get('relativePath') != path
                or frame.get('mimeType') != 'image/png'
                or not isinstance(frame.get('bytes'), int)
                or isinstance(frame.get('bytes'), bool) or frame['bytes'] < 1
                or not isinstance(frame.get('sha256'), str)
                or len(frame['sha256']) != 64 or not isinstance(media, dict)
                or media.get('frameIndex') != ordinal):
            raise ValueError('Un frame EffectCraft no coincide con su ordinal.')
        total += frame['bytes']
        entries.append({'ordinal': ordinal, 'relativePath': path,
                        'byteSize': frame['bytes'], 'sha256': frame['sha256']})
    manifest = {
        'schemaVersion': 1, 'format': FORMAT,
        'canvas': recipe.get('canvas'), 'frameCount': count,
        'relativePattern': pattern, 'entries': entries,
    }
    manifest_sha = canonical_sha256(manifest)
    provisional = EffectFrameBundlePlan(
        1, job.job_id, adapter.job_binding_sha256,
        candidate.get('recipeSha256'), job.input_manifest_sha256,
        adapter.plan_sha256, candidate['outputManifestSha256'], ARCHIVE_PATH,
        count, manifest, manifest_sha, total,
        job.limits.output_bytes - candidate.get('nativeProject', {}).get('bytes', 0), '')
    if provisional.max_archive_bytes < 1:
        raise ValueError('El proyecto nativo agotó la cuota del job EffectCraft.')
    return EffectFrameBundlePlan(
        **{**provisional.__dict__,
           'plan_sha256': canonical_sha256(_plan_body(provisional))})


def _entry(name: str) -> ZipInfo:
    info = ZipInfo(name, ZIP_TIME)
    info.compress_type = ZIP_STORED
    info.create_system = 3
    info.external_attr = FILE_MODE
    info.extra = b''
    info.comment = b''
    return info


def _stream_shape(plan: EffectFrameBundlePlan, sources: Mapping[str, BinaryIO],
                  target: BinaryIO, chunk_bytes: int) -> list[str]:
    expected = [item['relativePath'] for item in plan.manifest['entries']]
    if (not isinstance(plan, EffectFrameBundlePlan)
            or canonical_sha256(_plan_body(plan)) != plan.plan_sha256
            or set(sources) != set(expected) or not isinstance(chunk_bytes, int)
            or isinstance(chunk_bytes, bool) or not 65536 <= chunk_bytes <= 8 * 1024**2
            or not target.seekable() or not target.readable() or not target.writable()):
        raise ValueError('Los streams no cubren el bundle EffectCraft exacto.')
    return expected


def _receipt(plan: EffectFrameBundlePlan, source: BinaryIO,
             chunk_bytes: int) -> EffectFrameBundleReceipt:
    source.seek(0)
    sha, md5sum, size = sha256(), md5(), 0
    while chunk := source.read(chunk_bytes):
        sha.update(chunk)
        md5sum.update(chunk)
        size += len(chunk)
        if size > plan.max_archive_bytes:
            raise ValueError('El bundle EffectCraft supera la cuota del job.')
    return EffectFrameBundleReceipt(
        1, plan.archive_relative_path, 'application/zip', size,
        sha.hexdigest(), plan.frame_count, plan.manifest_sha256,
        plan.plan_sha256, b64encode(md5sum.digest()).decode('ascii'))


def package_effect_frame_bundle_stream(
        plan: EffectFrameBundlePlan, frame_streams: Mapping[str, BinaryIO],
        target: BinaryIO, *, chunk_bytes: int = 1024 * 1024
        ) -> EffectFrameBundleReceipt:
    """Write a deterministic ZIP without retaining the frame sequence in RAM."""
    _stream_shape(plan, frame_streams, target, chunk_bytes)
    manifest_bytes = json.dumps(
        plan.manifest, ensure_ascii=False, sort_keys=True,
        separators=(',', ':'), allow_nan=False).encode()
    target.seek(0)
    target.truncate(0)
    try:
        with ZipFile(target, 'w', compression=ZIP_STORED, allowZip64=True) as archive:
            archive.writestr(_entry(MANIFEST), manifest_bytes)
            for item in plan.manifest['entries']:
                source = frame_streams[item['relativePath']]
                if not source.readable() or not source.seekable():
                    raise ValueError('Un frame EffectCraft no es legible.')
                source.seek(0)
                digest, size = sha256(), 0
                with archive.open(_entry(item['relativePath']), 'w',
                                  force_zip64=True) as member:
                    while chunk := source.read(chunk_bytes):
                        member.write(chunk)
                        digest.update(chunk)
                        size += len(chunk)
                        if size > item['byteSize']:
                            raise ValueError(
                                'Los bytes de un frame no coinciden con el manifest.')
                if (size != item['byteSize']
                        or digest.hexdigest() != item['sha256']):
                    raise ValueError(
                        'Los bytes de un frame no coinciden con el manifest.')
        return _receipt(plan, target, chunk_bytes)
    except Exception:
        target.seek(0)
        target.truncate(0)
        raise


def package_effect_frame_bundle(plan: EffectFrameBundlePlan,
                                frame_bytes: dict[str, bytes]) -> bytes:
    """In-memory convenience wrapper for small fixtures."""
    expected = [item['relativePath'] for item in plan.manifest['entries']]
    if set(frame_bytes) != set(expected):
        raise ValueError('Los bytes no cubren la secuencia EffectCraft exacta.')
    target = BytesIO()
    streams = {path: BytesIO(payload) for path, payload in frame_bytes.items()}
    package_effect_frame_bundle_stream(plan, streams, target)
    return target.getvalue()


def validate_effect_frame_bundle_stream(
        plan: EffectFrameBundlePlan, source: BinaryIO, *,
        chunk_bytes: int = 1024 * 1024) -> EffectFrameBundleReceipt:
    if (not isinstance(plan, EffectFrameBundlePlan)
            or canonical_sha256(_plan_body(plan)) != plan.plan_sha256
            or not isinstance(chunk_bytes, int) or isinstance(chunk_bytes, bool)
            or not 65536 <= chunk_bytes <= 8 * 1024**2
            or not source.seekable() or not source.readable()):
        raise ValueError('El bundle EffectCraft no coincide con su plan.')
    receipt = _receipt(plan, source, chunk_bytes)
    if receipt.byte_size < 1:
        raise ValueError('El bundle EffectCraft no coincide con su plan.')
    source.seek(0)
    with ZipFile(source, 'r') as archive:
        infos = archive.infolist()
        names = [MANIFEST] + [item['relativePath']
                              for item in plan.manifest['entries']]
        if ([item.filename for item in infos] != names
                or any(item.compress_type != ZIP_STORED
                       or item.date_time != ZIP_TIME or item.extra
                       or item.comment or item.external_attr != FILE_MODE
                       for item in infos)):
            raise ValueError('El ZIP EffectCraft no es determinista.')
        manifest_info = infos[0] if infos else None
        if (manifest_info is None or manifest_info.file_size > 1024 * 1024
                or sum(item.file_size for item in infos[1:])
                != plan.uncompressed_bytes):
            raise ValueError('El ZIP EffectCraft no respeta las cuotas del manifest.')
        manifest = json.loads(archive.read(MANIFEST))
        if (manifest != plan.manifest
                or canonical_sha256(manifest) != plan.manifest_sha256):
            raise ValueError('El manifest empaquetado cambió.')
        for item in plan.manifest['entries']:
            info = archive.getinfo(item['relativePath'])
            digest, size = sha256(), 0
            with archive.open(info, 'r') as member:
                while chunk := member.read(chunk_bytes):
                    digest.update(chunk)
                    size += len(chunk)
                    if size > item['byteSize']:
                        raise ValueError('Un frame empaquetado cambió.')
            if (info.file_size != item['byteSize'] or size != item['byteSize']
                    or digest.hexdigest() != item['sha256']):
                raise ValueError('Un frame empaquetado cambió.')
    return receipt


def validate_effect_frame_bundle(
        plan: EffectFrameBundlePlan, archive_bytes: bytes
        ) -> EffectFrameBundleReceipt:
    if not isinstance(archive_bytes, bytes):
        raise ValueError('El bundle EffectCraft no coincide con su plan.')
    return validate_effect_frame_bundle_stream(plan, BytesIO(archive_bytes))

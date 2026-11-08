"""Project validated Craft results into the durable candidate asset shape."""

from .craft_capabilities import CAPABILITY_MATRIX_SHA256
from .craft_contracts import (CraftAdapterPlan, ResolvedCraftJob,
                              canonical_sha256, resolved_job_binding_sha256)
from .creative_asset_contract import _media
from .creative_effect_frame_bundle import (EffectFrameBundleReceipt,
    build_effect_frame_bundle_plan)


def _kind(mime_type: object) -> str:
    if not isinstance(mime_type, str):
        raise ValueError('El resultado Craft no declara MIME.')
    for prefix, kind in (('image/', 'image'), ('video/', 'video'),
                         ('audio/', 'audio')):
        if mime_type.startswith(prefix):
            return kind
    raise ValueError('El resultado Craft no produce un medio registrable.')


def _registry_media(output: dict) -> dict:
    raw = output.get('media')
    if not isinstance(raw, dict):
        raise ValueError('El resultado Craft no declara media.')
    metadata = {'kind': _kind(output.get('mimeType')), **raw}
    rate = metadata.get('frameRate')
    if isinstance(rate, dict):
        numerator, denominator = rate.get('numerator'), rate.get('denominator')
        if (not isinstance(numerator, int) or not isinstance(denominator, int)
                or denominator <= 0):
            raise ValueError('La cadencia Craft no es verificable.')
        metadata['frameRate'] = numerator / denominator
    _, media, blockers = _media(metadata)
    if blockers:
        raise ValueError('El resultado Craft conserva media incompleta.')
    return media


def _lineage(job: ResolvedCraftJob, adapter: CraftAdapterPlan,
             output: dict) -> dict:
    recipe_sha = canonical_sha256(job.plan.snapshot.get('recipe', {}))
    sources = [{'assetId': item.asset_id, 'revision': item.asset_revision}
               for item in job.inputs]
    supplied = output.get('lineage')
    expected = {'sources': sources, 'recipeSha256': recipe_sha,
                'jobBindingSha256': adapter.job_binding_sha256}
    if supplied is not None and supplied != expected:
        raise ValueError('El linaje Craft no coincide con el job resuelto.')
    return expected


def _draft(output: dict) -> dict:
    expected = {'state': 'candidate_local',
                'relativePath': output.get('relativePath'),
                'mimeType': output.get('mimeType')}
    supplied = output.get('storageDraft')
    if supplied is not None and supplied != expected:
        raise ValueError('El storageDraft Craft no coincide.')
    return expected


def _role(job: ResolvedCraftJob, output: dict) -> str:
    supplied = output.get('role')
    expected = {
        'photocraft': 'image_master',
        'effectcraft': 'rgba_frame',
        'filmcraft': 'video_master',
    }.get(job.engine.name)
    if expected is None or supplied is not None and supplied != expected:
        raise ValueError('El rol del resultado Craft no coincide.')
    return expected


def project_candidate_outputs(
        job: ResolvedCraftJob, adapter: CraftAdapterPlan, candidate: dict,
        identities: tuple[dict, ...]) -> list[dict]:
    """Add server-owned asset identity and lineage without weakening Craft checks."""
    raw_outputs = candidate.get('outputs')
    if not isinstance(raw_outputs, list) or len(raw_outputs) != len(identities):
        raise ValueError('Las identidades no cubren las salidas Craft exactas.')
    if job.engine.name == 'effectcraft' and len(raw_outputs) > 64:
        raise ValueError(
            'EffectCraft necesita empaquetado canónico para más de 64 frames.')
    result = []
    for ordinal, (raw, identity) in enumerate(zip(raw_outputs, identities)):
        if (not isinstance(raw, dict) or not isinstance(identity, dict)
                or set(identity) != {'outputId', 'assetId', 'revision'}
                or identity['revision'] != 1):
            raise ValueError('La identidad de salida candidata no es válida.')
        result.append({
            **identity, 'ordinal': ordinal, 'role': _role(job, raw),
            'relativePath': raw.get('relativePath'),
            'mimeType': raw.get('mimeType'), 'byteSize': raw.get('bytes'),
            'sha256': raw.get('sha256'), 'media': _registry_media(raw),
            'lineage': _lineage(job, adapter, raw),
            'storageDraft': _draft(raw),
        })
    return result


def project_effect_frame_bundle_output(
        job: ResolvedCraftJob, adapter: CraftAdapterPlan, candidate: dict,
        receipt: EffectFrameBundleReceipt, identity: dict) -> dict:
    """Collapse a long verified RGBA sequence into one reviewable ZIP asset."""
    raw = candidate.get('outputs')
    plan = build_effect_frame_bundle_plan(job, adapter, candidate)
    if (not isinstance(raw, list) or len(raw) <= 64
            or not isinstance(receipt, EffectFrameBundleReceipt)
            or receipt.archive_relative_path != plan.archive_relative_path
            or receipt.mime_type != 'application/zip'
            or receipt.frame_count != plan.frame_count
            or receipt.manifest_sha256 != plan.manifest_sha256
            or receipt.plan_sha256 != plan.plan_sha256
            or receipt.byte_size < 1 or len(receipt.sha256) != 64
            or receipt.publication_authorized
            or not isinstance(identity, dict)
            or set(identity) != {'outputId', 'assetId', 'revision'}
            or identity['revision'] != 1):
        raise ValueError('El bundle EffectCraft no coincide con la secuencia larga.')
    canvas = plan.manifest.get('canvas', {})
    rate = canvas.get('frameRate', {}) if isinstance(canvas, dict) else {}
    numerator, denominator = rate.get('numerator'), rate.get('denominator')
    if (not isinstance(numerator, int) or not isinstance(denominator, int)
            or denominator <= 0):
        raise ValueError('El bundle EffectCraft no conserva cadencia válida.')
    media = {'widthPixels': canvas.get('widthPixels'),
             'heightPixels': canvas.get('heightPixels'),
             'frameRate': rate, 'durationSeconds': plan.frame_count
             * denominator / numerator, 'frameCount': plan.frame_count,
             'manifestSha256': plan.manifest_sha256,
             'bundlePlanSha256': plan.plan_sha256, 'format': plan.manifest['format'],
             'hasAlpha': True}
    return {**identity, 'ordinal': 0, 'role': 'rgba_frame_bundle',
            'relativePath': receipt.archive_relative_path,
            'mimeType': receipt.mime_type, 'byteSize': receipt.byte_size,
            'sha256': receipt.sha256, 'media': media,
            'lineage': _lineage(job, adapter, raw[0]),
            'storageDraft': {'state': 'candidate_local',
                             'relativePath': receipt.archive_relative_path,
                             'mimeType': receipt.mime_type}}


def project_candidate_binding(job: ResolvedCraftJob, adapter: CraftAdapterPlan,
                              candidate: dict) -> dict:
    """Return every durable field that must be derived from validated authority."""
    engine = candidate.get('engine')
    if not isinstance(engine, dict):
        raise ValueError('El engine Craft no es verificable.')
    return {
        'jobBindingSha256': resolved_job_binding_sha256(job),
        'inputManifestSha256': job.input_manifest_sha256,
        'recipeSha256': canonical_sha256(job.plan.snapshot.get('recipe', {})),
        'adapterPlanSha256': adapter.plan_sha256,
        'capabilityMatrixSha256': CAPABILITY_MATRIX_SHA256,
        'engine': {'name': job.engine.name, 'version': job.engine.version,
                   'operation': job.operation,
                   'engineJobId': engine.get('engineJobId')},
    }

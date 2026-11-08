"""Una receta Craft liga fuentes y geometría sin interpretar texto libre."""

from copy import deepcopy

import pytest

from app.creative_edit_recipe import bind_edit_recipe, canonical_sha256
from app.creative_execution_draft import image_execution_draft, video_execution_draft
from app.creative_pricing_readiness import pricing_readiness
from app.creative_batch_pricing import batch_pricing_readiness
from test_creative_execution_draft import image_parts, video_parts


PLAN_SHA = 'a' * 64
ASSET = '11111111-1111-4111-8111-111111111111'


def sources(draft, strategy_sha, direction_sha):
    return {
        'sourcePlanSha256': PLAN_SHA,
        'executionSnapshotSha256': draft.snapshot_sha256,
        'strategySha256': strategy_sha,
        'directionSha256': direction_sha,
        'skillVersion': draft.skill_version,
        'skillSourceSha256': draft.skill_source_sha256,
    }


def receipt(kind='image'):
    mime = 'image/png' if kind == 'image' else 'video/mp4'
    dimensions = ({'widthPixels': 1024, 'heightPixels': 1024}
                  if kind == 'image' else
                  {'widthPixels': 1280, 'heightPixels': 720,
                   'durationSeconds': 3,
                   'frameRate': {'numerator': 24, 'denominator': 1}})
    return {'assetId': ASSET, 'revision': 1, 'kind': kind, **dimensions, 'receipt': {
        'bucket': 'uonify-private-media',
        'name': f'creative/users/u/assets/{ASSET}/hash.bin',
        'generation': 1, 'mimeType': mime, 'byteSize': 1234,
        'sha256': 'b' * 64,
    }}


def transform():
    return {'anchor': {'x': 0, 'y': 0}, 'position': {'x': 0, 'y': 0},
            'scalePercent': {'x': 100, 'y': 100}, 'rotationDegrees': 0,
            'opacityPercent': 100}


def style(width=1024, height=1024):
    return {'fontFamily': 'Inter', 'fontFallback': 'Arial', 'weight': 700,
            'sizePixels': 64, 'lineHeight': 1.1, 'tracking': 0,
            'alignment': 'left', 'fill': '#FFFFFFFF',
            'box': {'xPixels': 100, 'yPixels': 100,
                    'widthPixels': min(824, width - 100),
                    'heightPixels': min(300, height - 100),
                    'sourceWidthPixels': width,
                    'sourceHeightPixels': height}}


def test_image_recipe_binds_exact_copy_crop_assets_and_snapshots():
    strategy, directed = image_parts()
    draft = image_execution_draft(
        strategy, directed, pricing_readiness(directed.request))
    value = {
        'schemaVersion': 1, 'kind': 'image_edit', 'adapterOperation': 'image_edit',
        'sources': sources(draft, directed.strategy_sha256,
                           directed.direction_sha256),
        'target': {'mode': 'create'}, 'assets': [receipt()],
        'canvas': {'widthPixels': 1024, 'heightPixels': 1024},
        'layers': [{
            'kind': 'source', 'layerId': 'photo', 'sourceAssetId': ASSET,
            'zIndex': 0, 'crop': {'xPixels': 0, 'yPixels': 0,
                'widthPixels': 1024, 'heightPixels': 1024,
                'sourceWidthPixels': 1024, 'sourceHeightPixels': 1024},
            'transform': transform(),
        }, {
            'kind': 'text', 'layerId': 'headline', 'role': 'headline',
            'exactText': 'Tres partes visibles', 'zIndex': 1,
            'style': style(), 'transform': transform(),
        }], 'outputMimeType': 'image/png',
    }
    bound = bind_edit_recipe(PLAN_SHA, draft, directed, value)
    assert bound.ready_for_adapter and not bound.execution_authorized
    assert len(bound.recipe_sha256) == 64
    changed = deepcopy(value)
    changed['layers'][1]['exactText'] = 'Copy inventado'
    with pytest.raises(ValueError, match='copy'):
        bind_edit_recipe(PLAN_SHA, draft, directed, changed)
    outside = deepcopy(value)
    outside['layers'][0]['crop']['xPixels'] = 1
    with pytest.raises(ValueError, match='crop'):
        bind_edit_recipe(PLAN_SHA, draft, directed, outside)


def test_motion_recipe_requires_closed_timeline_order_and_no_invented_overlay():
    strategy, directed = video_parts()
    draft = video_execution_draft(
        strategy, directed, batch_pricing_readiness(directed.batch))
    direction_sha = canonical_sha256({
        'directions': [item.model_dump(mode='json')
                       for item in directed.directions],
        'batchSha256': directed.batch.batch_sha256,
    })
    base = {
        'schemaVersion': 1, 'kind': 'motion_graphics',
        'adapterOperation': 'motion_graphics',
        'sources': sources(draft, directed.strategy_sha256, direction_sha),
        'target': {'mode': 'create'}, 'assets': [],
        'canvas': {'widthPixels': 1280, 'heightPixels': 720,
                   'transparent': True,
                   'frameRate': {'numerator': 24, 'denominator': 1},
                   'durationFrames': 72},
        'layers': [{'kind': 'shape', 'layerId': 'panel', 'name': 'Panel',
                    'zIndex': 0, 'inFrame': 0, 'outFrame': 72,
                    'transform': transform()}],
        'keyframes': [
            {'layerId': 'panel', 'property': 'opacityPercent', 'frame': 0,
             'scalarValue': 0, 'interpolation': 'linear'},
            {'layerId': 'panel', 'property': 'opacityPercent', 'frame': 12,
             'scalarValue': 100, 'interpolation': 'ease_out'},
        ], 'output': {'mimeType': 'image/png',
                      'relativePattern': 'out/effectcraft/animated_%05d.png',
                      'frameCount': 72, 'rgba': True},
    }
    assert bind_edit_recipe(PLAN_SHA, draft, directed, base).recipe.kind == 'motion_graphics'
    invented = deepcopy(base)
    invented['layers'].append({
        'kind': 'text', 'layerId': 'invented', 'name': 'Invented',
        'zIndex': 1, 'inFrame': 0, 'outFrame': 72,
        'exactText': 'Texto no dirigido', 'style': style(1280, 720),
        'transform': transform(),
    })
    with pytest.raises(ValueError, match='overlays'):
        bind_edit_recipe(PLAN_SHA, draft, directed, invented)
    unordered = deepcopy(base)
    unordered['keyframes'].reverse()
    with pytest.raises(ValueError, match='ordenados'):
        bind_edit_recipe(PLAN_SHA, draft, directed, unordered)
    unobserved_pattern = deepcopy(base)
    unobserved_pattern['output']['relativePattern'] = 'out/effectcraft/frame-%06d.png'
    with pytest.raises(ValueError):
        bind_edit_recipe(PLAN_SHA, draft, directed, unobserved_pattern)


def test_video_recipe_is_a_variant_of_the_same_bound_family():
    strategy, directed = video_parts()
    draft = video_execution_draft(
        strategy, directed, batch_pricing_readiness(directed.batch))
    direction_sha = canonical_sha256({
        'directions': [item.model_dump(mode='json')
                       for item in directed.directions],
        'batchSha256': directed.batch.batch_sha256,
    })
    value = {
        'schemaVersion': 1, 'kind': 'video_assemble',
        'adapterOperation': 'video_export',
        'sources': sources(draft, directed.strategy_sha256, direction_sha),
        'target': {'mode': 'create'}, 'assets': [receipt('video')],
        'canvas': {'widthPixels': 1280, 'heightPixels': 720,
                   'frameRate': {'numerator': 24, 'denominator': 1},
                   'durationFrames': 72},
        'placements': [{'assetId': ASSET, 'track': 'V1', 'startFrame': 0,
                        'durationFrames': 72}],
        'outputMimeType': 'video/mp4',
    }
    bound = bind_edit_recipe(PLAN_SHA, draft, directed, value)
    assert bound.recipe.kind == 'video_assemble'
    stale = deepcopy(value)
    stale['sources']['executionSnapshotSha256'] = 'f' * 64
    with pytest.raises(ValueError, match='snapshots'):
        bind_edit_recipe(PLAN_SHA, draft, directed, stale)
    wrong_operation = deepcopy(value)
    wrong_operation['adapterOperation'] = 'video_assemble'
    with pytest.raises(ValueError):
        bind_edit_recipe(PLAN_SHA, draft, directed, wrong_operation)

"""El snapshot previo a aprobación liga estrategia, solicitudes y precio parcial."""

from dataclasses import replace
import json

import pytest

from app.creative_batch_pricing import batch_pricing_readiness
from app.creative_execution_draft import (image_execution_draft,
                                          video_execution_draft)
from app.creative_execution_operations import (image_request_operations,
                                                video_request_operations)
from app.creative_image_direction import compile_directed_image
from app.creative_planning import AUDITED_PROJECT
from app.creative_pricing_readiness import pricing_readiness
from app.creative_skill_compiler import compile_skill_plan
from app.creative_strategy_contract import bind_strategy
from app.creative_video_direction import (ShotDirection,
                                          compile_directed_video_batch)


def video_parts(external_voice=False):
    compilation = compile_skill_plan({
        'recipe': 'cinematic_video', 'objective': 'Ciudad bajo la lluvia nocturna',
        'sourceMode': 'uony_concept',
        'modelChoice': 'gemini-omni-1.1-flash-preview', 'durationSeconds': 3,
    }, AUDITED_PROJECT)
    context = {
        'purchaseSituation': 'La pieza presenta una historia visual autónoma.',
        'motivation': 'El espectador quiere descubrir el mundo de la escena.',
        'objection': 'La escena podría parecer genérica o no tener resolución.',
        'persuasionIdea': 'Una acción física completa revela la ciudad.',
        'hypothesis': 'Una acción clara mantendrá la atención hasta el cierre.',
        'primaryMetric': 'watch_time', 'claims': [],
        'beats': [{'unitId': 'shot-01',
                   'buyerQuestion': '¿Qué sucede en esta ciudad?',
                   'newInformation': 'Un vehículo revela la escala de la avenida.'}],
    }
    strategy = bind_strategy(compilation, context)
    direction = ShotDirection(
        unitId='shot-01', purpose='Revelar la escala de la ciudad nocturna',
        framing='Plano general horizontal con avenida y horizonte visibles',
        action='Un vehículo cruza y deja reflejos sobre el asfalto mojado',
        camera='follow', endState='La avenida queda vacía y estable al final',
        transition='cut',
        spokenAudioMode='external_tts' if external_voice else 'none',
        voiceover=('La ciudad despierta bajo la lluvia.'
                   if external_voice else None))
    directed = compile_directed_video_batch(
        compilation, (direction,), project=AUDITED_PROJECT,
        omni_output_prefixes=('gs://uonify-private-media/draft/shot-01/',),
        strategy=strategy, strategy_context=context)
    return strategy, directed


def image_parts(headline='Tres partes visibles'):
    compilation = compile_skill_plan({
        'recipe': 'product_diagram',
        'objective': 'Explicar tres partes visibles de un objeto',
        'sourceMode': 'uony_concept',
    }, AUDITED_PROJECT)
    context = {
        'purchaseSituation': 'La persona necesita entender el objeto rápidamente.',
        'motivation': 'Quiere reconocer sus partes visibles y su organización.',
        'objection': 'Una vista recargada puede ocultar la estructura principal.',
        'persuasionIdea': 'Una placa limpia deja espacio para callouts exactos.',
        'hypothesis': 'Una jerarquía simple facilitará la comprensión visual.',
        'primaryMetric': 'click_through', 'claims': [],
        'beats': [{'unitId': 'image-01',
                   'buyerQuestion': '¿Cómo se organiza visualmente el objeto?',
                   'newInformation': 'La placa separa con claridad sus tres zonas.'}],
    }
    strategy = bind_strategy(compilation, context)
    direction = {
        'unitId': 'image-01', 'assetPurpose': 'final_static',
        'placement': 'Feed móvil', 'aspectRatio': '1:1',
        'primaryVisual': 'Objeto aislado y centrado con tres zonas visibles',
        'hierarchy': 'Objeto principal primero y espacio lateral para callouts',
        'photography': 'Estudio limpio, perspectiva natural y bordes definidos',
        'motivatedLight': 'Luz amplia frontal izquierda con sombra de apoyo suave',
        'occupancy': 'Sin personas ni reflejos de terceros',
        'copySpace': 'Tres áreas laterales tranquilas para callouts controlados',
        'copyManifest': [{'role': 'headline', 'exactText': headline}],
    }
    directed = compile_directed_image(
        compilation, strategy, context, direction, project=AUDITED_PROJECT)
    return strategy, directed


def test_video_draft_binds_batch_and_partial_price_without_opening_approval():
    strategy, directed = video_parts()
    pricing = batch_pricing_readiness(directed.batch)
    draft = video_execution_draft(strategy, directed, pricing)
    assert draft.request_hashes == directed.batch.request_hashes
    assert draft.request_group_sha256 == directed.batch.batch_sha256
    assert len(draft.snapshot_sha256) == 64
    assert draft.complete_maximum_usd is None
    assert not draft.ready_for_quote and not draft.approval_ready
    assert not draft.execution_authorized


def test_image_draft_binds_strategy_and_request_without_claiming_maximum():
    strategy, directed = image_parts()
    draft = image_execution_draft(
        strategy, directed, pricing_readiness(directed.request))
    assert draft.medium == 'imagen' and len(draft.request_hashes) == 1
    assert draft.known_generation_component_usd > 0
    assert 'tokens de entrada' in draft.missing_for_maximum[0]
    changed_strategy, changed = image_parts('Conoce sus tres partes')
    changed_draft = image_execution_draft(
        changed_strategy, changed, pricing_readiness(changed.request))
    assert changed_draft.request_hashes == draft.request_hashes
    assert changed_draft.request_group_sha256 != draft.request_group_sha256
    assert changed_draft.snapshot_sha256 != draft.snapshot_sha256


def test_external_tts_is_a_separate_bound_request_with_published_ceiling():
    strategy, directed = video_parts(external_voice=True)
    draft = video_execution_draft(
        strategy, directed, batch_pricing_readiness(directed.batch))
    assert len(directed.voiceovers) == 1 and len(draft.request_hashes) == 2
    assert draft.request_hashes[-1] == directed.voiceovers[0].request_sha256
    assert draft.request_group_sha256 != directed.batch.batch_sha256
    assert draft.known_generation_component_usd == (
        batch_pricing_readiness(directed.batch).known_generation_component_usd
        + pricing_readiness(directed.voiceovers[0].request).known_generation_usd)
    assert not any('voz TTS' in item for item in draft.missing_for_maximum)


def test_video_operation_ids_keep_generation_and_tts_distinct():
    strategy, directed = video_parts(external_voice=True)
    draft = video_execution_draft(
        strategy, directed, batch_pricing_readiness(directed.batch))
    operations = video_request_operations(draft, directed)
    assert [item.ordinal for item in operations] == [1, 2]
    assert [item.unit_id for item in operations] == ['shot-01', 'shot-01']
    assert [item.kind for item in operations] == ['video_generation', 'voiceover']
    assert operations[0].operation_id != operations[1].operation_id
    assert tuple(item.request_sha256 for item in operations) == draft.request_hashes
    snapshots = [json.loads(item.request_snapshot_json) for item in operations]
    assert snapshots[0]['model'] == directed.batch.model
    assert snapshots[0]['endpoint'] == directed.batch.requests[0].endpoint
    assert snapshots[1]['model'] == directed.voiceovers[0].request.model
    assert video_request_operations(draft, directed) == operations


def test_image_operation_id_is_deterministic_and_bound_to_direction():
    strategy, directed = image_parts()
    draft = image_execution_draft(
        strategy, directed, pricing_readiness(directed.request))
    operation = image_request_operations(draft, directed)[0]
    assert operation.ordinal == 1 and operation.unit_id == 'image-01'
    assert operation.kind == 'image_generation'
    assert operation.request_sha256 == draft.request_hashes[0]


def test_changed_draft_cannot_relabel_request_operations():
    strategy, directed = video_parts()
    draft = video_execution_draft(
        strategy, directed, batch_pricing_readiness(directed.batch))
    with pytest.raises(ValueError, match='draft cerrado'):
        video_request_operations(replace(draft, request_hashes=('f' * 64,)), directed)


def test_changed_batch_or_strategy_is_rejected():
    strategy, directed = video_parts()
    pricing = batch_pricing_readiness(directed.batch)
    with pytest.raises(ValueError, match='cambiaron'):
        video_execution_draft(
            strategy, directed, replace(pricing, batch_sha256='f' * 64))
    with pytest.raises(ValueError, match='misma versión'):
        video_execution_draft(
            replace(strategy, strategy_sha256='d' * 64), directed, pricing)
    image_strategy, image = image_parts()
    with pytest.raises(ValueError, match='corresponden'):
        image_execution_draft(
            replace(image_strategy, strategy_sha256='e' * 64), image,
            pricing_readiness(image.request))
    with pytest.raises(ValueError, match='cambiaron'):
        image_execution_draft(
            image_strategy, replace(image, direction_sha256='f' * 64),
            pricing_readiness(image.request))

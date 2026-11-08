"""Regresiones del compilador privado; no generan ni reservan medios."""

from app.creative_planning import AUDITED_PROJECT, SKILL_VERSION, SOURCE_SHA256
from app.creative_skill_compiler import compile_skill_plan


def test_cinematic_plan_is_split_into_observed_veo_units():
    compiled = compile_skill_plan({
        'recipe': 'cinematic_video',
        'objective': 'Ciudad futurista bajo la lluvia nocturna',
        'sourceMode': 'uony_concept',
        'modelChoice': 'veo-3.1-generate-001',
        'durationSeconds': 9,
    }, AUDITED_PROJECT)
    assert compiled.request_compile_ready
    assert not compiled.execution_authorized
    assert len(compiled.units) == 3
    assert compiled.generated_seconds == 12 and compiled.trim_seconds == 3
    assert compiled.units[-1].end_seconds == 9
    assert 'recortar 3s' in compiled.units[-1].finishing[-1]


def test_reference_video_keeps_asset_bindings_as_explicit_blockers():
    compiled = compile_skill_plan({
        'recipe': 'reference_video',
        'objective': 'Mostrar el objeto girando en un estudio limpio',
        'sourceMode': 'provided',
        'modelChoice': 'gemini-omni-1.1-flash-preview',
        'durationSeconds': 9,
        'referenceNeeds': [
            {'role': 'product', 'kind': 'image',
             'description': 'Fotografía principal del objeto'},
            {'role': 'motion', 'kind': 'video',
             'description': 'Clip que guía el movimiento'},
        ],
    }, AUDITED_PROJECT)
    assert len(compiled.units) == 3
    assert compiled.units[0].reference_requirements == (
        'product:image', 'motion:video')
    assert compiled.generated_seconds == 9 and compiled.trim_seconds == 0
    assert not compiled.request_compile_ready
    assert compiled.plan_blockers == (
        'vincular referencia 1 product:image',
        'vincular referencia 2 motion:video')


def test_commercial_proof_and_destination_never_become_synthetic():
    compiled = compile_skill_plan({
        'recipe': 'review_card',
        'objective': 'Presentar una reseña real del servicio',
        'audience': 'Personas que comparan alternativas de servicio',
        'offer': 'Sesión inicial de planificación',
        'sourceMode': 'provided',
    }, AUDITED_PROJECT)
    assert len(compiled.units) == 1
    assert 'vincular evidencia auténtica' in compiled.plan_blockers[0]
    assert 'definir CTA' in compiled.plan_blockers[1]
    assert not compiled.request_compile_ready and not compiled.execution_authorized


def test_missing_video_choices_produce_no_fictitious_units():
    compiled = compile_skill_plan({
        'recipe': 'ugc_video',
        'objective': 'Demostración breve de una rutina cotidiana',
        'sourceMode': 'undecided',
    }, AUDITED_PROJECT)
    assert compiled.units == () and compiled.generated_seconds is None
    assert compiled.plan_blockers == (
        'elegir materiales aportados o creatividad de Uony',
        'elegir expresamente el modelo de vídeo',
        'fijar la duración total')


def test_unknown_project_never_inherits_the_audited_capability():
    compiled = compile_skill_plan({
        'recipe': 'cinematic_video',
        'objective': 'Plano atmosférico de una ciudad al amanecer',
        'sourceMode': 'uony_concept',
        'modelChoice': 'veo-3.1-generate-001',
        'durationSeconds': 4,
    }, 'another-project')
    assert 'comprobar modelo, región, cuota y pagador' in compiled.plan_blockers[0]
    assert not compiled.request_compile_ready


def test_compilation_pins_the_private_source_version_and_hash():
    compiled = compile_skill_plan({
        'recipe': 'product_diagram',
        'objective': 'Explicar visualmente tres partes del producto',
        'sourceMode': 'uony_concept',
    }, AUDITED_PROJECT)
    assert compiled.source_skill_version == SKILL_VERSION
    assert compiled.source_sha256 == SOURCE_SHA256
    assert compiled.request_compile_ready and not compiled.execution_authorized


def test_thirty_seconds_are_not_hidden_inside_one_omni_request():
    compiled = compile_skill_plan({
        'recipe': 'cinematic_video',
        'objective': 'Historia de treinta segundos en una ciudad futurista',
        'sourceMode': 'uony_concept',
        'modelChoice': 'gemini-omni-1.1-flash-preview',
        'durationSeconds': 30,
    }, AUDITED_PROJECT)
    assert len(compiled.units) == 10
    assert compiled.generated_seconds == 30 and compiled.trim_seconds == 0
    assert compiled.request_compile_ready


def test_unobserved_veo_standard_reference_mode_stays_blocked():
    compiled = compile_skill_plan({
        'recipe': 'reference_video',
        'objective': 'Conservar la identidad del objeto en un plano',
        'sourceMode': 'provided',
        'modelChoice': 'veo-3.1-generate-001',
        'durationSeconds': 4,
        'referenceNeeds': [{'role': 'product', 'kind': 'image',
                            'description': 'Vista principal del objeto'}],
    }, AUDITED_PROJECT)
    assert compiled.units == ()
    assert 'duración o referencias sin ruta Google comprobada' in compiled.plan_blockers
    assert not compiled.request_compile_ready

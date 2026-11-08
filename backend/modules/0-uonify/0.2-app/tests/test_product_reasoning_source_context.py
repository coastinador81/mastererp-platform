"""Reservas locales: el OCR no independiza un dato del registro del que procede."""
from copy import deepcopy
from app.product_reasoning_context import build_context
from app.product_reasoning_source_context import attach_reconciliation_context
from app.product_reasoning_provider import model_parts
from app.product_reasoning_reconciliation import alternative_evidence
from test_product_reasoning import fixture, leaf


def made(segments):
    data = fixture(properties={'item_length': leaf('number')}, texts=segments, pictures=0)
    ctx = build_context(*data)
    attach_reconciliation_context(ctx, data[3], data[4])
    return ctx, data


def test_ocr_inherits_exact_page_reservation_without_changing_prompt_or_fingerprint():
    data = fixture(properties={'item_length': leaf('number')}, pictures=0, texts=[
        {'locator': 'Página 1', 'text': 'Valores nominales del modelo 3D. Longitud 400 mm.'},
        {'locator': 'Página 1 · OCR 3', 'text': '400 mm', 'method': 'ocr'},
        {'locator': 'Página 2', 'text': 'Informe: longitud medida: 500 mm.'},
        {'locator': 'Página 2 · OCR 2', 'text': '500 mm', 'method': 'ocr'}])
    ctx = build_context(*data); fingerprint = ctx['fingerprint']; parts = deepcopy(model_parts(ctx))
    attach_reconciliation_context(ctx, data[3], data[4])
    states = ctx['_reconciliationSourceStates']
    by_locator = {e['locator']: e for e in ctx['evidence']}
    nominal = by_locator['Página 1 · OCR 3']['id']; real = by_locator['Página 2 · OCR 2']['id']
    assert nominal in states and states[nominal]['proof']['locator'] == 'Página 1'
    assert real not in states and ctx['fingerprint'] == fingerprint and model_parts(ctx) == parts
    selected, _ = alternative_evidence(ctx, ctx['targets'][0])
    assert real in selected and nominal not in selected


def test_mixed_page_with_real_500mm_measurement_is_not_globally_nominal():
    ctx, _ = made([{'locator': 'Página 1', 'text': 'Diseño nominal: 400 mm. Medida real: 500 mm.'},
        {'locator': 'Página 1 · OCR 2', 'text': '500 mm', 'method': 'ocr'}])
    assert ctx['_reconciliationSourceStates'] == {}
    assert alternative_evidence(ctx, ctx['targets'][0])[0]


def test_pending_page_and_xlsx_row_are_not_physical_measurements():
    ctx, _ = made([{'locator': 'Página 1', 'text': 'Datos por completar\nMuestra física\nMedidas finales y tolerancias.\nAporta: Fabricante / medición'},
        {'locator': 'Página 1 · OCR 2', 'text': 'Medidas finales y tolerancias', 'method': 'ocr'},
        {'locator': 'Ficha!fila 12', 'text': 'A: Medidas finales | B: Aportar muestra medida | F: Pendiente'}])
    assert len(ctx['_reconciliationSourceStates']) == 3
    assert alternative_evidence(ctx, ctx['targets'][0]) == ([], [])


def test_status_on_one_json_record_does_not_invalidate_physical_other_record():
    ctx, _ = made([
        {'locator': '$.fields[0].label', 'text': 'Longitud'}, {'locator': '$.fields[0].value', 'text': '400'},
        {'locator': '$.fields[0].status', 'text': '"pending"'},
        {'locator': '$.fields[1].label', 'text': 'Longitud medida'}, {'locator': '$.fields[1].value', 'text': '500'},
        {'locator': '$.fields[1].unit', 'text': 'mm'}, {'locator': '$.fields[1].status', 'text': '"measured"'}])
    pending = next(e['id'] for e in ctx['evidence'] if e['locator'] == '$.fields[0].value')
    real = next(e['id'] for e in ctx['evidence'] if e['locator'] == '$.fields[1].value')
    assert pending in ctx['_reconciliationSourceStates'] and real not in ctx['_reconciliationSourceStates']
    assert real in alternative_evidence(ctx, ctx['targets'][0])[0]

import re
import pytest
from app.product_materials_fields import canonical_field
from app.product_materials_analyzer import validate_output


@pytest.mark.parametrize('field,label', [
    ('name', 'Nombre del producto'), ('brand', ' MARCA '), ('category', 'Tipo de producto'),
    ('description', 'Descripción'), ('bullets', 'Viñetas'), ('bullets', 'Puntos clave'),
    ('keywords', 'TÉRMINOS DE BÚSQUEDA'), ('keywords', 'Palabras clave'),
    ('name', 'Product name'), ('keywords', 'Search terms'),
])
def test_standard_fields_require_an_explicit_semantic_alias(field, label):
    assert canonical_field(field, label) == field


@pytest.mark.parametrize('field,label', [
    ('keywords', 'EAN / GTIN-13'), ('bullets', 'Contenido del set'), ('name', 'Modelo'),
    ('brand', 'Fabricante'), ('keywords', 'Marca'), ('category', 'Dimensiones'),
])
def test_unrelated_labels_cannot_write_standard_fields(field, label):
    result = canonical_field(field, label)
    assert re.fullmatch(r'custom:[a-zA-Z][a-zA-Z0-9_-]{0,63}', result)
    assert result == canonical_field(field, label.upper())
    assert result == canonical_field(field, label)


def test_custom_ids_stay_stable_and_long_or_non_ascii_labels_are_valid():
    assert canonical_field('custom:material', 'Material') == 'custom:material'
    for label in ('3+ años', 'Largo ' * 20, '品牌', ''):
        assert re.fullmatch(r'custom:[a-zA-Z][a-zA-Z0-9_-]{0,63}', canonical_field('name', label))
    assert canonical_field('name', '品牌') != canonical_field('name', '材质')


def test_validated_ean_and_set_contents_are_custom_before_proposal_ids_are_computed():
    source = {'id': 'spec', 'segments': [{'locator': 'Ficha', 'text': '8435833200006; 54 piezas'}]}
    def proposal(field, label, value):
        return {'field': field, 'label': label, 'value': value,
                'evidence': [{'sourceId': 'spec', 'locator': 'Ficha', 'excerpt': value}]}
    output = validate_output({'proposals': [
        proposal('keywords', 'EAN / GTIN-13', '8435833200006'),
        proposal('bullets', 'Contenido del set', '54 piezas'),
        proposal('custom:ean_gtin_13', 'EAN / GTIN-13', '8435833200006'),
    ]}, [source])
    assert [item['field'] for item in output['proposals']] == [
        'custom:ean_gtin_13', 'custom:contenido_del_set', 'custom:ean_gtin_13']
    assert output['proposals'][0]['id'] == output['proposals'][2]['id']
    assert all(item['evidence'][0]['sourceId'] == 'spec' for item in output['proposals'])

"""El retorno de autorización conserva el chat en su pestaña original."""
import pytest
from app.amazon_pages import page, result_page


@pytest.mark.parametrize('flow_id,error', [
    ('fixture-flow', None),
    ('fixture-flow', 'seller_changed'),
    ('fixture-flow', 'denied'),
    (None, 'invalid_state'),
])
def test_return_page_never_opens_another_uonify_tab(flow_id, error):
    result = result_page('http://127.0.0.1:5173', flow_id, error)
    html = result.body.decode()
    assert 'window.open(' not in html
    assert 'window.close()' in html
    assert 'Tu conversación sigue allí.' in html
    assert 'Cerrar y volver a Uonify' in html
    assert 'Nexus' not in html
    assert 'uonify-amazon-return' in html
    assert "frame-ancestors 'none'" in result.headers['content-security-policy']


def test_amazon_initiated_intent_keeps_explicit_uonify_entry():
    result = page('Continúa', 'Confirma en Uonify', 'http://127.0.0.1:5173', intent='fixture-intent')
    html = result.body.decode()
    assert 'http://127.0.0.1:5173/?amazon_intent=fixture-intent' in html
    assert 'target="_blank" rel="noopener"' in html
    assert 'Continuar en Uonify' in html

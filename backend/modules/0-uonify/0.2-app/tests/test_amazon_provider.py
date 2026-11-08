"""Formatos oficiales Amazon y validación estricta de destinos de consentimiento."""
from dataclasses import replace
import json
import pytest
from app.amazon_provider import load_config, validate_amazon_callback, AmazonConfig


@pytest.mark.parametrize('prefix', ['amzn1.sellerapps.app.', 'amzn1.sp.solution.'])
def test_official_application_identifiers(environment, tmp_path, prefix):
    config, _, _ = environment
    app = prefix + 'test-12345678'
    (tmp_path / 'amazon-config.json').write_text(json.dumps({
        'publicOrigin': 'https://gateway.example.test', 'applicationId': app,
        'clientId': 'amzn1.application-oa2-client.test-12345678'}))
    (tmp_path / 'amazon-client-secret').write_text('fixture-secret-for-test-only')
    actual = load_config(replace(config, secrets_directory=str(tmp_path)))
    assert actual.ready
    assert actual.application_id == app


@pytest.mark.parametrize('host', ['amazon.com', 'sellercentral-europe.amazon.com'])
def test_documented_callback_hosts_keep_exact_path(host):
    app = 'amzn1.sellerapps.app.test-12345678'
    config = AmazonConfig(application_id=app)
    target = 'https://' + host + '/apps/authorize/confirm/' + app
    assert validate_amazon_callback(target, config) == target
    for invalid in [target + '?redirect=evil', target + '#fragment', target + '/extra',
                    target.replace(host, host + '.evil.test'), target.replace(app, 'another-app')]:
        with pytest.raises(ValueError):
            validate_amazon_callback(invalid, config)

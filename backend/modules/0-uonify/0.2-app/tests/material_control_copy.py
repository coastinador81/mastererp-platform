"""The exact visible control decision sent by current clients in no-provider tests."""
from uuid import uuid4

from app.product_materials_control_consent import advertised_control_consent


def control_body(action, *, revision=1, request_id=None, **extra):
    copy = advertised_control_consent(action)
    return {
        'requestId': str(request_id or uuid4()), 'revision': revision,
        'consentVersion': copy['version'], 'consentText': copy['text'],
        'consentSha256': copy['sha256'], **extra,
    }

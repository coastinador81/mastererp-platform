"""Exact initial Drive-analysis decision for fake-provider integration tests."""
from app.product_materials_consent import (
    MATERIAL_START_CONSENT_VERSION, MATERIAL_START_CONSENT_TEXT,
    MATERIAL_START_CONSENT_SHA256,
)


def start_body(body):
    return {**body, 'consentVersion': MATERIAL_START_CONSENT_VERSION,
            'consentText': MATERIAL_START_CONSENT_TEXT,
            'consentSha256': MATERIAL_START_CONSENT_SHA256}


def start_kwargs():
    return {'consent_version': MATERIAL_START_CONSENT_VERSION,
            'consent_text': MATERIAL_START_CONSENT_TEXT,
            'consent_sha256': MATERIAL_START_CONSENT_SHA256}

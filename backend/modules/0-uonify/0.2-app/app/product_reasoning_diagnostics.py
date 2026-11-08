"""Clasifica rechazos Google sin conservar cuerpo remoto, prompts, cabeceras o secretos."""
import hashlib
from .product_materials_analyzer import safe_diagnostics

MESSAGES = {
    'schema_complexity': 'Google rechazó la complejidad del esquema de respuesta.',
    'schema_invalid': 'Google rechazó la estructura del esquema de respuesta.',
    'schema_keyword': 'Google no admite una palabra clave del esquema de respuesta.',
    'thinking_configuration': 'Google no admite esta configuración de razonamiento para el modelo.',
    'output_limit': 'Google rechazó el límite de salida solicitado.',
    'input_limit': 'La entrada supera un límite admitido por Google.',
    'image_payload': 'Google rechazó el formato o los datos de una imagen.',
    'model_configuration': 'Google rechazó el modelo o su ubicación.',
    'quota': 'Google rechazó la solicitud por límite de capacidad o cuota.',
    'permission': 'Google rechazó el acceso solicitado.',
    'invalid_argument': 'Google rechazó un argumento de la solicitud.',
    'provider_unavailable': 'Google no pudo procesar la solicitud.',
}
STATUSES = {'INVALID_ARGUMENT', 'PERMISSION_DENIED', 'UNAUTHENTICATED', 'RESOURCE_EXHAUSTED',
            'NOT_FOUND', 'FAILED_PRECONDITION', 'UNAVAILABLE', 'INTERNAL', 'DEADLINE_EXCEEDED'}
FIELDS = ('response_schema', 'responseSchema', 'thinking_level', 'thinkingLevel', 'thinking_budget',
          'thinkingBudget', 'max_output_tokens', 'maxOutputTokens', 'inline_data', 'inlineData',
          'anyOf', 'nullable', 'enum', 'maxItems', 'propertyOrdering', 'response_mime_type', 'responseMimeType')
VALIDATION_REASONS = {
    'output_not_object', 'output_collection_missing', 'output_collection_type', 'too_many_items',
    'item_not_object', 'target_id_type', 'target_id_unknown', 'target_id_duplicate',
    'value_json_missing', 'value_json_invalid', 'value_not_scalar', 'value_null_inferred',
    'value_present_not_inferred', 'evidence_refs_type', 'evidence_refs_limit',
    'evidence_ref_type', 'evidence_ref_unknown', 'basis_invalid', 'reason_type', 'reason_limit',
    'verification_boolean_type', 'quote_type', 'pixel_verification_type', 'state_invalid',
    'requested_refs_type', 'requested_refs_limit', 'requested_ref_type', 'requested_ref_unknown',
    'value_missing', 'value_type_invalid', 'output_invalid_json',
    'resolution_invalid', 'resolution_acceptance_mismatch', 'resolution_support_missing',
    'resolution_retrieval_mismatch', 'resolution_without_proposed_value',
}
OUTPUT_STATS = {'itemIndex', 'targetIndex', 'itemCount', 'expectedTargetCount', 'evidenceRefCount',
                'requestedRefCount', 'outputCharacters', 'decodedCharacters', 'unansweredTargetCount'}


def rejection_diagnostics(response):
    try:
        body = response.json()
    except (ValueError, TypeError):
        body = {}
    error = body.get('error', {}) if isinstance(body, dict) else {}
    message = error.get('message', '') if isinstance(error, dict) else ''
    message = message if isinstance(message, str) else ''
    folded = message.lower()
    if any(s in folded for s in ('too complex', 'too many states', 'complexity', 'maximum number of states')):
        reason = 'schema_complexity'
    elif 'thinking' in folded:
        reason = 'thinking_configuration'
    elif any(s in folded for s in ('unknown name', 'unsupported field', 'unsupported keyword')) and any(s in folded for s in ('schema', 'nullable', 'anyof')):
        reason = 'schema_keyword'
    elif 'schema' in folded:
        reason = 'schema_invalid'
    elif 'maxoutputtokens' in folded or 'max_output_tokens' in folded:
        reason = 'output_limit'
    elif any(s in folded for s in ('too many tokens', 'input token', 'request size', 'payload size', 'too large')):
        reason = 'input_limit'
    elif any(s in folded for s in ('image', 'inline_data', 'inlinedata', 'mime')):
        reason = 'image_payload'
    elif 'model' in folded or 'location' in folded:
        reason = 'model_configuration'
    else:
        reason = {400: 'invalid_argument', 401: 'permission', 403: 'permission', 429: 'quota'}.get(response.status_code, 'provider_unavailable')
    diagnostic = {'httpStatus': response.status_code, 'providerReason': reason, 'providerMessage': MESSAGES[reason]}
    if isinstance(error, dict) and error.get('status') in STATUSES:
        diagnostic['providerStatus'] = error['status']
    if message:
        diagnostic['providerErrorFingerprint'] = hashlib.sha256(message.encode()).hexdigest()
        diagnostic['providerFields'] = [name for name in FIELDS if name.lower() in folded]
    return diagnostic, body.get('usageMetadata', {}) if isinstance(body, dict) else {}


def safe_reasoning_diagnostics(value):
    if not isinstance(value, dict): return {}
    result = safe_diagnostics(value)
    reason = value.get('providerReason')
    if reason in MESSAGES:
        result.update(providerReason=reason, providerMessage=MESSAGES[reason])
    if value.get('providerStatus') in STATUSES: result['providerStatus'] = value['providerStatus']
    fingerprint = value.get('providerErrorFingerprint')
    if isinstance(fingerprint, str) and len(fingerprint) == 64 and all(c in '0123456789abcdef' for c in fingerprint):
        result['providerErrorFingerprint'] = fingerprint
    if isinstance(value.get('providerFields'), list):
        result['providerFields'] = [field for field in value['providerFields'] if field in FIELDS]
    if value.get('validationReason') in VALIDATION_REASONS:
        result['validationReason'] = value['validationReason']
    for key in OUTPUT_STATS:
        if isinstance(value.get(key), int) and not isinstance(value[key], bool) and 0 <= value[key] <= 10_000_000:
            result[key] = value[key]
    return result

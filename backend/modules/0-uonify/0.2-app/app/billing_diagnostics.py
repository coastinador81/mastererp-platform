"""Diagnóstico cliente acotado: nunca acredita ni modifica un pago."""
import re
from typing import Literal
from uuid import UUID
from fastapi import HTTPException
from pydantic import Field, field_validator
from psycopg.types.json import Jsonb
from .onboarding import StrictBody


class CheckoutDiagnostic(StrictBody):
    checkoutAttemptId: UUID
    phase: Literal['configuration', 'script', 'initialization', 'mount']
    category: Literal['configuration', 'connection', 'expired', 'completed',
                      'integration', 'initialization', 'mount']
    errorName: Literal['Error', 'TypeError', 'IntegrationError', 'ReferenceError',
                       'SecurityError', 'AbortError', 'InvalidStateError', 'Object',
                       'String', 'Unknown']
    message: str = Field(min_length=1, max_length=1200)

    @field_validator('checkoutAttemptId', mode='before')
    @classmethod
    def uuid_from_json(cls, value):
        # StrictBody evita coerciones; JSON representa los UUID mediante strings.
        if not isinstance(value, str):
            raise ValueError('Referencia de intento no válida.')
        try:
            return UUID(value)
        except ValueError as error:
            raise ValueError('Referencia de intento no válida.') from error


def safe_message(message):
    # Un encabezado puede contener varios valores cortos que no parecen tokens.
    text = re.sub(r'\b(?:authorization|proxy-authorization|cookie|set-cookie)["\']?\s*:\s*[^\r\n]*',
                  '[header redacted]', message, flags=re.I)
    # También la ruta de un enlace puede contener secretos cortos o datos personales.
    text = re.sub(r'https?://[^\s<>"\']+', '[URL]', text, flags=re.I)
    text = re.sub(r'[^\s<>"\'=]+@[^\s<>"\']+', '[email]', text)
    text = re.sub(r'\b(?:[psre]k_(?:test|live)_|whsec_|'
                  r'(?:cs|pi|seti|cus|acct|sub|in|pm|price|prod|si|ch|src|tok|card|ek)_)[A-Za-z0-9_=-]+',
                  '[redacted]', text, flags=re.I)
    text = re.sub(r'\bBearer\s+[^\s,;]+', 'Bearer [redacted]', text, flags=re.I)
    text = re.sub(r'\b((?:client[ _-]*secret|api[ _-]*key|access[ _-]*token|refresh[ _-]*token|token|password)'
                  r'["\']?\s*[=:]\s*)["\']?[^\s,;"\']+', r'\1[redacted]', text, flags=re.I)
    # Incluye JWT/base64/tokens opacos sin depender de prefijos de un proveedor.
    text = re.sub(r'(?<![\w])[A-Za-z0-9_+/=-]{24,}(?![\w])', '[redacted]', text)
    text = re.sub(r'(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)', '[redacted]', text)
    text = ''.join(char if char >= ' ' and char != '\x7f' else ' ' for char in text)
    return text.strip()[:1200] or '[redacted]'


def record_diagnostic(connection, user, body):
    details = {'phase': body.phase, 'category': body.category,
               'errorName': body.errorName, 'message': safe_message(body.message)}
    row = connection.execute('''UPDATE billing_checkouts
        SET client_error_details=%s,client_error_at=now()
        WHERE id=%s AND user_id=%s AND ui_mode='embedded' RETURNING id''',
        (Jsonb(details), body.checkoutAttemptId, user['id'])).fetchone()
    if not row:
        raise HTTPException(404, detail={'error': 'checkout_not_found',
                            'message': 'No se ha encontrado este intento de pago.'})

"""Immutable console evidence: amounts are observed, not calculated from AI usage."""
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
import hashlib
import json
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from uuid import uuid4
from pydantic import Field, field_validator, model_validator
from psycopg.types.json import Jsonb
from .onboarding import StrictBody


def money(value):
    if value is None:
        return None
    amount = Decimal(value)
    if not amount.is_finite() or amount < 0 or amount >= Decimal('1000000000000000000'):
        raise ValueError('Importe no válido.')
    if amount != amount.quantize(Decimal('0.01')):
        raise ValueError('Demasiados decimales.')
    return format(amount, '.2f')


class CreditEntry(StrictBody):
    amountEUR: str = Field(pattern=r'^\d{1,18}(?:\.\d{1,2})?$')
    expiresAt: datetime | None = None
    expiresOn: date | None = None

    @field_validator('amountEUR')
    @classmethod
    def amount(cls, value):
        return money(value)

    @field_validator('expiresAt')
    @classmethod
    def expiry(cls, value):
        if value is not None and value.utcoffset() is None:
            raise ValueError('La fecha necesita zona horaria.')
        return value

    @model_validator(mode='after')
    def one_expiry_format(self):
        if self.expiresAt is not None and self.expiresOn is not None:
            raise ValueError('Conservar solo la precisión de fecha publicada por Google.')
        return self


class Observation(StrictBody):
    projectId: str = Field(pattern=r'^[a-z][a-z0-9-]{4,28}[a-z0-9]$')
    billingAccountName: str = Field(pattern=r'^billingAccounts/[A-Za-z0-9-]+$')
    currency: str = Field(pattern=r'^EUR$')
    creditEUR: str | None = Field(default=None, pattern=r'^\d{1,18}(?:\.\d{1,2})?$')
    consumptionEUR: str | None = Field(default=None, pattern=r'^\d{1,18}(?:\.\d{1,2})?$')
    netConsumptionEUR: str | None = Field(default=None, pattern=r'^\d{1,18}(?:\.\d{1,2})?$')
    consumptionScope: str = Field(default='billing_account', pattern=r'^billing_account$')
    periodStart: date | None = None
    periodEnd: date | None = None
    observedAt: datetime
    creditExpiresAt: datetime | None = None
    creditExpiresOn: date | None = None
    creditEntries: list[CreditEntry] = Field(default_factory=list, max_length=100)
    sourceURL: str = Field(max_length=2000)
    proofFiles: list[str] = Field(min_length=1, max_length=10)

    @field_validator('creditEUR', 'consumptionEUR', 'netConsumptionEUR')
    @classmethod
    def amount(cls, value):
        return money(value)

    @field_validator('observedAt', 'creditExpiresAt')
    @classmethod
    def timestamp(cls, value):
        if value is not None and value.utcoffset() is None:
            raise ValueError('La fecha necesita zona horaria.')
        return value

    @field_validator('sourceURL')
    @classmethod
    def source(cls, value):
        url = urlparse(value)
        if url.scheme != 'https' or url.netloc != 'console.cloud.google.com' or not url.path.startswith('/billing/'):
            raise ValueError('La fuente debe ser Google Cloud Billing.')
        if url.fragment or set(parse_qs(url.query, keep_blank_values=True)) - {'authuser', 'project', 'hl'}:
            raise ValueError('La URL de evidencia no debe contener credenciales.')
        return value

    @model_validator(mode='after')
    def consistency(self):
        account_id = self.billingAccountName.split('/', 1)[1]
        if not urlparse(self.sourceURL).path.startswith('/billing/' + account_id + '/'):
            raise ValueError('La fuente debe corresponder a la cuenta de facturación observada.')
        if self.observedAt > datetime.now(timezone.utc) + timedelta(minutes=5):
            raise ValueError('La observación no puede estar en el futuro.')
        if self.creditEUR is None and self.consumptionEUR is None:
            raise ValueError('Falta un importe observado.')
        if self.consumptionEUR is not None and (not self.periodStart or not self.periodEnd):
            raise ValueError('El consumo necesita un periodo observado.')
        if self.netConsumptionEUR is not None and self.consumptionEUR is None:
            raise ValueError('El consumo neto necesita el coste bruto observado.')
        if self.periodStart and self.periodEnd and self.periodStart > self.periodEnd:
            raise ValueError('Periodo no válido.')
        if self.creditExpiresAt and (self.creditEUR is None or self.creditExpiresAt <= self.observedAt):
            raise ValueError('El crédito debe estar vigente en la observación.')
        if self.creditExpiresOn and (self.creditEUR is None or self.creditExpiresOn <= self.observedAt.astimezone(timezone.utc).date()):
            raise ValueError('El crédito debe estar vigente en la fecha observada.')
        if self.creditExpiresAt is not None and self.creditExpiresOn is not None:
            raise ValueError('Conservar solo la precisión de fecha publicada por Google.')
        if self.creditEntries:
            if self.creditEUR is None or any((e.expiresAt and e.expiresAt <= self.observedAt) or
                    (e.expiresOn and e.expiresOn <= self.observedAt.astimezone(timezone.utc).date()) for e in self.creditEntries):
                raise ValueError('No incluir créditos vencidos.')
            if sum(Decimal(e.amountEUR) for e in self.creditEntries) != Decimal(self.creditEUR):
                raise ValueError('La suma de créditos no coincide con la cifra observada.')
        return self


def proof_files(root, names):
    root = Path(root).resolve(strict=True)
    proofs = []
    for name in names:
        path = (root / name).resolve(strict=True)
        if not path.is_relative_to(root) or not path.is_file() or path.suffix.lower() not in ('.png', '.jpg', '.jpeg', '.webp', '.pdf', '.csv'):
            raise ValueError('Archivo de evidencia no válido.')
        if path.stat().st_size > 30 * 1024 * 1024:
            raise ValueError('Archivo de evidencia demasiado grande.')
        proofs.append({'path': str(path.relative_to(root)), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
    return proofs


def record(connection, user, cloud, observation, proofs):
    payload = observation.model_dump(mode='json')
    if cloud['google_subject'] != user['google_subject'] or cloud['project_id'] != observation.projectId:
        raise ValueError('La cuenta o el proyecto de la observación no coincide.')
    proof_hash = hashlib.sha256(json.dumps(proofs, sort_keys=True).encode()).hexdigest()
    fingerprint = hashlib.sha256(json.dumps({'data': payload, 'proof': proofs}, sort_keys=True).encode()).hexdigest()
    row = connection.execute('''INSERT INTO google_billing_observations
        (id,user_id,google_subject,project_id,billing_account_name,currency,credit_eur,consumption_eur,net_consumption_eur,
         consumption_scope,period_start,period_end,observed_at,credit_expires_at,credit_expires_on,credit_entries,
         source_kind,source_url,proof_sha256,proof_files,observation_sha256)
        VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'observed_google_console',%s,%s,%s,%s)
        ON CONFLICT(user_id,google_subject,project_id,billing_account_name,observation_sha256) DO NOTHING RETURNING id''',
        (uuid4(), user['id'], user['google_subject'], observation.projectId, observation.billingAccountName,
         observation.currency, observation.creditEUR, observation.consumptionEUR, observation.netConsumptionEUR, observation.consumptionScope,
         observation.periodStart, observation.periodEnd, observation.observedAt, observation.creditExpiresAt, observation.creditExpiresOn,
         Jsonb([e.model_dump(mode='json') for e in observation.creditEntries]), observation.sourceURL,
         proof_hash, Jsonb(proofs), fingerprint)).fetchone()
    return bool(row)


def latest(connection, user, cloud, billing_account=None):
    condition = ' AND billing_account_name=%s' if billing_account else ''
    params = (user['id'], user['google_subject'], cloud['project_id']) + ((billing_account,) if billing_account else ())
    return connection.execute('''SELECT * FROM google_billing_observations
        WHERE user_id=%s AND google_subject=%s AND project_id=%s''' + condition +
        ' ORDER BY observed_at DESC,recorded_at DESC LIMIT 1', params).fetchone()

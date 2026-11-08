"""Lector del bucket de SALIDA §6 al momento del claim (piloto clips-only, mundo 090).

Resuelve qué bucket GCS usar para el output_prefix que persiste `claim_creative_step`. Fuente FIJADA por
el Consultor (27-10, §BUILD ronda 4): el ALLOWLIST de config `settings.creative_output_buckets` (env
UONIFY_CREATIVE_OUTPUT_BUCKETS) — el MISMO allowed_output_buckets que validan el reader/context_loader y el
envelope en el despacho, y que usa el cableado craft de ArtCraft. Config del SERVIDOR, NUNCA del
cliente/cuerpo ⇒ no influible. El bucket por-cliente en su proyecto (creative_media_output_bucket.py,
"Lote A M1") es el diseño de PRODUCCIÓN/FUTURO y NO se usa en el piloto.

El invariante 119 valida el PROYECTO (project==quote.google_project_id + connected+ready+billing+subject),
no el bucket; eso lo comprueba la lectura de la conexión Cloud (cableado del live_provider). La región
us-central1 se toma de `settings.creative_output_location`; la verificación FÍSICA de región (metadata GCS)
queda FUERA del lock del claim (el allowlist del operador contiene SOLO buckets us-central1, condición del
Consultor).

CONTRATO DE SEGURIDAD DEL CLAIM COMPARTIDO: `claim_creative_step` es del mundo 090 (lo comparten flujos
que no son clips-only). Por eso este lector NUNCA lanza: devuelve None siempre que el bucket no se resuelva
con confianza (allowlist vacío = release no ha activado la feature; región mal; piloto multi-bucket sin
mapa proyecto→bucket). None ⇒ el claim persiste output_prefix NULL ⇒ el reader clips-only falla cerrado
(no despacha). Así la feature queda GATEADA por config sin romper NINGÚN otro claim 090. Fail-closed para
el DESPACHO, no-rompe para el CLAIM. Ante misconfig con allowlist NO vacía (región/multi/malformado) emite
log.warning (condición del Consultor §BUILD ronda 5) = señal al operador, SIN excepción; no registra el
bucket ni el project (card-safe).
"""
from __future__ import annotations

import logging
import re

_log = logging.getLogger(__name__)
_BUCKET = re.compile(r'[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]\Z')
_LOCATION = 'us-central1'


def clips_only_output_bucket(settings, *, google_project: str | None) -> str | None:
    """Bucket §6 allowlisted para el proyecto aprobado, o None si no se resuelve con confianza.

    Piloto: exactamente UN bucket us-central1 en la allowlist (su co-ubicación con el proyecto único del
    piloto es la que el 119 valida en el despacho). Multi-bucket/multi-proyecto necesita un mapa
    proyecto→bucket (futuro) ⇒ None hasta entonces."""
    buckets = tuple(getattr(settings, 'creative_output_buckets', ()) or ())
    if not buckets:
        # Allowlist vacía = release no activó la feature → feature off, SIN warning (estado esperado).
        return None  # dispatch fail-closed vía reader.
    # Allowlist NO vacía pero sin resolver = MISCONFIG del operador: log.warning (condición del Consultor,
    # §BUILD ronda 5) para señalarlo sin excepción (nunca lanza: un raise mataría el claim 090 compartido).
    # No se registran el nombre del bucket ni el project (card-safe / D-PROTECCIÓN); solo el motivo.
    location = getattr(settings, 'creative_output_location', '')
    if not isinstance(location, str) or location.lower() != _LOCATION:
        _log.warning('clips-only: allowlist de salida no vacía pero la región configurada '
                     'no es us-central1; feature off.')
        return None  # región de salida no co-ubicada con Veo.
    if len(buckets) != 1:
        _log.warning('clips-only: allowlist de salida con %d buckets; el piloto exige exactamente 1 '
                     '(falta mapa proyecto→bucket); feature off.', len(buckets))
        return None  # piloto = un único bucket; multi necesita mapa proyecto→bucket (futuro).
    if not isinstance(google_project, str) or not google_project:
        _log.warning('clips-only: generación con allowlist fijada pero sin proyecto aprobado que '
                     'anclar; feature off.')
        return None  # el 119 valida el proyecto aparte en el despacho.
    bucket = buckets[0]
    if (not isinstance(bucket, str) or not _BUCKET.fullmatch(bucket)
            or '..' in bucket):
        _log.warning('clips-only: nombre de bucket de salida mal formado en la config; feature off.')
        return None  # nombre de bucket mal formado en la config.
    return bucket

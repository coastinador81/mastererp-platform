"""Aserción de cableado para `bind_google_provider_request` (condición «unfreeze» del Consultor).

Al cablear el despacho, el prefijo de salida DERIVADO por `bind_google_provider_request`
(`binding.namespace.uri`, §6) DEBE coincidir con el PERSISTIDO por `reserve_once` en la fila del
intento (output_prefix, migración 129). Esta es la defensa fail-closed que exige el veredicto del
runner: «leer el prefijo persistido de la 129 o ASERTAR derivado==persistido». No bifurca
`bind_google` (el cuerpo Veo sigue suyo); solo cruza el prefijo antes del POST.

STAGED + INERTE: función pura, sin red ni DB. La llamará el context_loader al armar el
`GoogleGenerationStepContext` (output_prefix), antes de que el envelope haga el único POST.
"""
from __future__ import annotations

import re

from .creative_google_dispatch_codes import PREFIX_MISMATCH
from .creative_google_provider_request import GoogleProviderRequestBinding

# Forma §6 idéntica a `google_provider_output_uri` / `_VEO_OUTPUT_PREFIX` del transporte y al CHECK de
# la 129: gs://<bucket>/creative/staging/google/<owner>/<attempt>/provider/<operation>/
_PREFIX = re.compile(
    r'gs://(?P<bucket>[a-z0-9][a-z0-9._-]{1,220}[a-z0-9])/'
    r'creative/staging/google/[0-9a-f-]{36}/[0-9a-f-]{36}/provider/[0-9a-f-]{36}/\Z')


class ClipsOnlyPrefixError(ValueError):
    """Fail-closed: el prefijo de salida derivado no coincide con el persistido (129).

    F1: porta dispatch_code=PREFIX_MISMATCH para el log del worker. Hardening REA (28-10): extiende
    ValueError (antes Exception) para UNIFORMAR «rechazo determinista pre-POST = ValueError»; backward-compat
    (ValueError⊂Exception → los `except Exception` existentes siguen cazándolo). Hoy se lanza solo pre-dispatch
    (context_loader), pero así, si el check del prefijo se moviera al camino de dispatch, el envelope lo
    clasificaría como aborted. Defensa en profundidad; 0-cargo intacto."""

    dispatch_code = PREFIX_MISMATCH


def assert_bound_prefix_matches_persisted(
        binding: GoogleProviderRequestBinding, persisted_output_prefix: str) -> str:
    """Cruza el prefijo derivado por bind_google con el persistido por la reserva (129). Devuelve el
    prefijo confirmado; lanza `ClipsOnlyPrefixError` fail-closed ante cualquier discrepancia o forma
    inválida. El context_loader usa el resultado como `output_prefix` del step (una sola fuente)."""
    if not isinstance(binding, GoogleProviderRequestBinding):
        raise ClipsOnlyPrefixError('El binding Google no es válido.')
    if (not isinstance(persisted_output_prefix, str)
            or not _PREFIX.fullmatch(persisted_output_prefix)):
        raise ClipsOnlyPrefixError('El prefijo persistido no tiene la forma §6 esperada.')
    derived = getattr(binding.namespace, 'uri', None)
    snapshot_uri = binding.snapshot.get('uri') if isinstance(binding.snapshot, dict) else None
    # El snapshot del binding (que se firma) y el namespace derivado deben coincidir ambos con el
    # persistido: así el POST solo puede escribir en el prefijo reservado exacto.
    if derived != persisted_output_prefix or snapshot_uri != persisted_output_prefix:
        raise ClipsOnlyPrefixError(
            'El prefijo derivado por bind_google no coincide con el persistido (129).')
    return persisted_output_prefix

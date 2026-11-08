"""(b) Derivación del output_prefix §6 a PERSISTIR en el claim del intento (mundo 090, clips-only).

Lógica pura + fail-closed de lo que el edit de `claim_creative_step` escribirá en
`creative_execution_attempts.output_prefix` (columna/CHECK/trigger de la migración 134). Dado el paso
reclamado (su `kind`/`provider_call`/`request_operation_id`), el owner, el `attempt_id` del intento y el
BUCKET de salida (INYECTADO — resolverlo es el CABLEADO que vuelve al Consultor con la credencial),
devuelve el prefijo §6 a INSERTar, o None si el paso no es una generación Google con llamada a proveedor
(clips-only solo direcciona salida para esa).

ORIGEN DEL BUCKET (resuelto por el Consultor 27-10, §BUILD ronda 4): NO es columna de
google_cloud_connections (la migración 006 solo tiene project_id/project_check/status) ni derivable del
project_id. Es el ALLOWLIST de config `settings.creative_output_buckets` (env UONIFY_CREATIVE_OUTPUT_BUCKETS)
— el MISMO allowed_output_buckets que el reader/context_loader validan en el despacho — así que es config
del SERVIDOR, nunca del cliente/cuerpo ⇒ no influible. El invariante 119 valida el PROYECTO
(project==quote.google_project_id + connected+ready+billing+subject), NO el bucket; por eso el cableado
AÑADE: (i) bucket ∈ settings.creative_output_buckets y (ii) región us-central1. La verificación FÍSICA de
región (check_bucket = llamada de red a GCS) queda FUERA del lock del claim; el allowlist del operador
contiene solo buckets us-central1. En el claim se elige el bucket allowlisted del proyecto aprobado.

BISAGRA DEL ÍTEM 4 (lo que cierra el lazo, verificado por el Consultor):
  operation_id persistido  ==  s.request_operation_id  ==  authority.operation_id que reconstruye el
  reader (creative_clips_only_reader) ==> prefijo reconstruido == prefijo persistido ==> la aserción
  derived==persisted del reader pasa. Mismo constructor `google_provider_output_uri` que la 129/134, así
  que la forma es byte-idéntica al CHECK de la 134 y al _VEO_OUTPUT_PREFIX del transporte.

STAGED + INERTE: este módulo NO se importa todavía en el coordinador. El edit real de
`claim_creative_step` (abajo, como DISEÑO a validar) es el cableado; aquí va la lógica a radiografiar.
D-PROTECCIÓN: no registra €, tokens ni ids al cliente; el prefijo es interno.

DISEÑO del edit de claim_creative_step (NO aplicado; vuelve al Consultor + REA):
  1) `_candidate` SELECT (coordinator.py:522): añadir  s.request_operation_id, q.google_project_id
     a la lista de columnas (hoy trae s.step_id,s.ordinal,s.kind,s.depends_on,s.provider_call,
     q.uonify_project_id,q.edit_recipe).
  2) En `claim_creative_step`, tras calcular `attempt_id` (:595) y ANTES del INSERT (:598):
        bucket = <CABLEADO: bucket allowlisted (settings.creative_output_buckets) del proyecto aprobado;
                  119 valida project==q.google_project_id; AÑADIR bucket∈allowlist + región us-central1;
                  check físico de región fuera del lock del claim>
        output_prefix = clips_only_attempt_output_prefix(
            step_kind=row['kind'], provider_call=row['provider_call'],
            request_operation_id=(str(row['request_operation_id'])
                                  if row['request_operation_id'] else None),
            bucket=bucket, owner_user_id=str(owner['id']), attempt_id=str(attempt_id))
  3) Añadir `output_prefix` a las columnas y VALUES del INSERT de creative_execution_attempts (:598-607).
     Write-once (134) ⇒ se escribe SOLO en este INSERT inicial; None ⇒ columna NULL (CHECK lo permite).
El bucket NO entra como parámetro de red aquí: el helper lo recibe ya resuelto (elegido del allowlist de
config) para que el gasto/medios sigan en la cuenta del cliente (marketplace) y el cableado del lector del
bucket vuelva al Consultor. Buckets prod por-cliente (en su propio proyecto) = diseño FUTURO, no piloto.
"""
from __future__ import annotations

from .creative_google_provider_namespace import google_provider_output_uri

_GOOGLE_GENERATION_KIND = 'google_generation'


class ClipsOnlyAttemptPrefixError(ValueError):
    """Fail-closed: no se pudo derivar un output_prefix §6 verificable para el intento."""


def clips_only_attempt_output_prefix(*, step_kind: str, provider_call: bool,
                                     request_operation_id: str | None, bucket: str,
                                     owner_user_id: str, attempt_id: str) -> str | None:
    """Prefijo §6 a persistir, o None si el paso no direcciona salida de proveedor Google.

    `google_provider_output_uri` valida owner/attempt/operation como UUID canónicos y el bucket
    (bucket_metadata_endpoint), y compone la forma idéntica al CHECK de la 134. Cualquier paso
    google_generation con provider_call DEBE traer operation_id (lo garantiza la rehidratación:
    un paso que liga proveedor liga su operación); su ausencia es fail-closed."""
    if step_kind != _GOOGLE_GENERATION_KIND or not provider_call:
        # clips-only solo reserva prefijo para la generación Google con llamada a proveedor.
        return None
    if not isinstance(request_operation_id, str) or not request_operation_id:
        raise ClipsOnlyAttemptPrefixError(
            'La generación Google no liga un request_operation_id persistido.')
    try:
        return google_provider_output_uri(
            bucket, owner_user_id, attempt_id, request_operation_id)
    except ValueError as error:
        raise ClipsOnlyAttemptPrefixError(str(error)) from error

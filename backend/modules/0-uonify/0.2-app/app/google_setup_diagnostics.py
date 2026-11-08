"""Retain bounded Google failure evidence; expose only plain recovery guidance."""
import re
from .google_cloud_provider import CloudError

REASONS={
    'SERVICE_DISABLED':'service_disabled', 'BILLING_DISABLED':'billing_required',
    'BILLING_NOT_ACTIVE':'billing_required', 'CONSUMER_INVALID':'quota_project_required',
    'USER_PROJECT_DENIED':'quota_project_denied', 'ACCESS_TOKEN_SCOPE_INSUFFICIENT':'reauthorize',
    'RATE_LIMIT_EXCEEDED':'quota_exceeded', 'QUOTA_EXCEEDED':'quota_exceeded',
    'SECURITY_POLICY_VIOLATED':'organization_policy', 'ORG_RESTRICTION_VIOLATION':'organization_policy',
    'LOCATION_POLICY_VIOLATED':'organization_policy',
}
GUIDANCE={
    'reauthorize':('authorization','Google necesita que vuelvas a autorizar esta cuenta. Conservaremos el proyecto y tu progreso.'),
    'service_disabled':('api','Google indica que falta activar un servicio necesario para utilizar la IA. Actívalo y vuelve aquí para continuar.'),
    'billing_required':('billing','Google indica que la facturación no está activa para esta operación. Revisa la facturación del proyecto y vuelve aquí.'),
    'quota_project_required':('connection','Google no ha podido identificar el proyecto para esta operación. Conservamos tu elección; la conexión necesita revisión antes de probar otra vez.'),
    'quota_project_denied':('permissions','Google no permite utilizar este proyecto para el consumo de IA. Revisa el permiso de uso de servicios del proyecto.'),
    'quota_exceeded':('quota','Google ha alcanzado un límite de uso de este proyecto. Revisa sus cuotas o espera a que se restablezcan antes de autorizar otra prueba.'),
    'organization_policy':('policy','Una política de la organización de Google impide esta operación. Su administrador debe revisarla antes de continuar.'),
    'model_unavailable':('model','Google no ofrece este modelo en el proyecto o la ubicación elegidos. Revisa su disponibilidad antes de autorizar otra prueba.'),
    'model_not_allowed':('model','Google no ha autorizado este proyecto para utilizar el modelo. Revisa su acceso en Google antes de autorizar otra prueba.'),
    'model_terms_required':('model','Google pide completar las condiciones de uso del modelo. Revísalas en Google y vuelve aquí para continuar.'),
    'invalid_request':('connection','Google ha rechazado el formato de la prueba de Uony. Necesitamos revisar la integración; repetirla ahora no resolvería el problema.'),
    'permission_denied':('permissions','Google ha rechazado la operación. No ha quedado identificado qué permiso o condición falta; revisa el acceso en Google antes de autorizar otra prueba.'),
    'google_unavailable':('unknown','No hemos podido confirmar la respuesta de Google. Tu progreso se conserva y no repetiremos la prueba automáticamente.'),
    'invalid_response':('unknown','Google no ha entregado un resultado que podamos confirmar. No repetiremos la prueba automáticamente.'),
}


def clean_message(value):
    if not isinstance(value,str):
        return None
    value=re.sub(r'https?://\S+','[enlace oficial omitido]',value)
    value=re.sub(r'(?i)Bearer\s+\S+','Bearer [oculto]',value)
    value=re.sub(r'(?i)((?:access_token|refresh_token|client_secret|authorization)[\s"\x27:=]+)\S+',r'\1[oculto]',value)
    value=re.sub(r'(?:ya29\.|AIza)[A-Za-z0-9_.-]+','[oculto]',value)
    return ''.join(character for character in value if character.isprintable() or character=='\n')[:1200]


def response_error(response):
    try:
        body=response.json()
    except (ValueError,TypeError):
        body={}
    error=body.get('error',{}) if isinstance(body,dict) else {}
    error=error if isinstance(error,dict) else {}
    details={'httpStatus':response.status_code}
    status=error.get('status')
    if isinstance(status,str) and re.fullmatch(r'[A-Z_]{1,80}',status):
        details['googleStatus']=status
    message=clean_message(error.get('message'))
    if message:
        details['providerMessage']=message
    for info in error.get('details',[]) if isinstance(error.get('details'),list) else []:
        if not isinstance(info,dict) or info.get('@type')!='type.googleapis.com/google.rpc.ErrorInfo':
            continue
        reason=info.get('reason')
        if isinstance(reason,str) and re.fullmatch(r'[A-Z0-9_]{1,80}',reason):
            details['reason']=reason
        domain=info.get('domain')
        if isinstance(domain,str) and re.fullmatch(r'(?:[a-z0-9-]+\.)*googleapis\.com',domain):
            details['domain']=domain
        metadata=info.get('metadata')
        for key in ('service','permission'):
            value=metadata.get(key) if isinstance(metadata,dict) else None
            if isinstance(value,str) and re.fullmatch(r'[A-Za-z0-9_.-]{1,160}',value):
                details[key]=value
        resource=metadata.get('resource') if isinstance(metadata,dict) else None
        if (isinstance(resource,str) and len(resource)<=480 and '..' not in resource
            and re.fullmatch(r'projects/[A-Za-z0-9_-]+/locations/[a-z0-9-]+/publishers/[a-z0-9-]+/models/[A-Za-z0-9_.:@-]+',resource)):
            details['resource']=resource
    code=REASONS.get(details.get('reason')) or {
        400:'invalid_request',401:'reauthorize',403:'permission_denied',404:'not_found',
        409:'already_exists',429:'quota_exceeded'}.get(response.status_code,'google_unavailable')
    # Some Google model restrictions have no ErrorInfo; retain the bounded
    # evidence and distinguish explicit wording without guessing missing IAM.
    lower=(error.get('message') or '').lower() if isinstance(error.get('message'),str) else ''
    if response.status_code in (400,403,404):
        if 'publisher model' in lower and ('not allowed' in lower or 'not authorized' in lower):
            code='model_not_allowed'
        elif ('terms of service' in lower or 'terms of use' in lower) and 'accept' in lower:
            code='model_terms_required'
    failure=CloudError(code)
    failure.setup_diagnostic=details
    return failure


def api_error_reason(error):
    """The ErrorInfo reason of a google-genai APIError (its `details`, the
    response JSON), or None: only the reason code, never the message or any
    other detail (capa 2, D8 «Consultor google»)."""
    payload=getattr(error,'details',None)
    if isinstance(payload,dict) and isinstance(payload.get('error'),dict):
        payload=payload['error']
    infos=payload.get('details') if isinstance(payload,dict) else None
    for info in infos if isinstance(infos,list) else ():
        if not isinstance(info,dict) or info.get('@type')!='type.googleapis.com/google.rpc.ErrorInfo':
            continue
        reason=info.get('reason')
        if isinstance(reason,str) and re.fullmatch(r'[A-Z0-9_]{1,80}',reason):
            return reason
    return None


def public_failure(row):
    code=row.get('error_code')
    if not code or row['status']=='ready':
        return None
    if code=='reauthorize':
        from .google_setup_access import authorization_needed
        if not authorization_needed(row):
            return {'category':'model','message':'La autorización de Google está renovada. La prueba de respuesta sigue necesitando tu autorización.'}
    details=row.get('error_details') or {}
    if (code=='permission_denied' and (row.get('step')=='model' or row.get('model_test')=='failed')
        and (details.get('permission')=='aiplatform.endpoints.predict'
            or (details.get('reason')=='IAM_PERMISSION_DENIED'
                and 'aiplatform.endpoints.predict' in str(details.get('providerMessage',''))))):
        return {'category':'model','message':'Google rechazó el acceso al modelo. Revisaremos la conexión sin generar contenido; este rechazo no confirma que falten permisos del proyecto.'}
    if code=='model_test_unknown':
        code='google_unavailable'
    if code not in GUIDANCE:
        return None
    category,message=GUIDANCE[code]
    return {'category':category,'message':message}

"""Conteo real de entrada: lectura aislada, sin generación ni cambios de conversación."""
from datetime import datetime, timezone
from fastapi import APIRouter, Request, HTTPException
from cryptography.fernet import Fernet
from .onboarding import require_user
from .access import workspace_access
from .security import require_origin
from .google_cloud_provider import CloudError
from .uony_projects import check_thread
from .uony_context import ContextRequest, HISTORY_LIMIT, MODEL_INPUT_LIMITS, cloud_selection, conversation_context, model_label

# Capa 2: the meter never names the provider (owner's list of fixed texts).
UNMEASURED='No he podido medir el contexto ahora. Puedes seguir trabajando y volver a consultarlo.'


def routes(settings,database,cloud,provider,incidents=None,materials=None):
    router=APIRouter()
    cipher=Fernet(settings.encryption_key)

    @router.post('/context')
    def context(body:ContextRequest,request:Request):
        require_origin(request,settings.origin)
        with database.connect() as connection:
            user=require_user(connection,request)
            if not user.get('onboarding_completed_at') or workspace_access(connection,user)['status']!='allowed':
                raise HTTPException(403,detail={'error':'access_required','message':'Completa el alta y activa tu acceso a Uonify para consultar el contexto.'})
            check_thread(connection,user,body)
            row,selected,_=cloud_selection(connection,user,body.model,body.effort)
            # Solo ficha y declaraciones forman la entrada inicial. No consultar estados
            # operativos: services() también concilia trabajos vencidos de Blender.
            history,status,turns=conversation_context(connection,user,body,database,{},incidents,materials)
        limit=MODEL_INPUT_LIMITS.get(selected)
        result={'status':'unavailable','model':selected,'modelLabel':model_label(selected),
                'usedTokens':None,'limitTokens':limit,'remainingTokens':None,'usageRatio':None,
                'measuredAt':datetime.now(timezone.utc).isoformat(),'historyTurns':turns,
                'historyLimit':HISTORY_LIMIT,'measurement':None}
        if limit is None or not callable(getattr(provider,'count_tokens',None)):
            return {**result,'reason':'limit_unknown' if limit is None else 'count_unavailable',
                    'message':'Todavía no podemos medir el contexto de este modelo.'}
        try:
            token=cloud.refresh(cipher.decrypt(row['refresh_encrypted'].encode()).decode())
            count=provider.count_tokens(token,row['project_id'],history,status,model=selected,effort=body.effort)
            if type(count) is not int or count<0:
                raise CloudError('invalid_response')
        except CloudError as error:
            return {**result,'reason':error.code,'message':UNMEASURED}
        return {**result,'status':'measured','usedTokens':count,'remainingTokens':max(0,limit-count),
                'usageRatio':count/limit,'measurement':'google_count_tokens',
                'measuredAt':datetime.now(timezone.utc).isoformat()}
    return router

"""Proyectos del espacio: agrupan hilos, aislados por cuenta de Uonify."""
from uuid import UUID
from fastapi import APIRouter, HTTPException, Request
from pydantic import Field
from .onboarding import StrictBody, require_user
from .security import require_origin
from .access import workspace_access

class Project(StrictBody):
    id: UUID = Field(strict=False)
    name: str = Field(min_length=1,max_length=80)


def check_thread(connection,user,body):
    project=str(body.projectId) if body.projectId else None
    if project and not connection.execute('SELECT 1 FROM uony_projects WHERE user_id=%s AND id=%s AND deleted_at IS NULL',(user['id'],project)).fetchone():
        raise HTTPException(404,detail={'error':'project_not_found','message':'No se encuentra este proyecto en tu cuenta.'})
    existing=connection.execute('SELECT project_id,deleted_at FROM uony_threads WHERE user_id=%s AND id=%s',(user['id'],body.threadId)).fetchone() if body.threadId else None
    if existing:
        if existing['deleted_at']:
            raise HTTPException(410,detail={'error':'thread_deleted','message':'Este hilo se ha eliminado. Crea uno nuevo para continuar.'})
        saved=str(existing['project_id']) if existing['project_id'] else None
        if saved!=project:
            raise HTTPException(409,detail={'error':'thread_project_conflict','message':'Este hilo pertenece a otro proyecto. Ábrelo desde el panel de conversaciones.'})
    return existing


def ensure_thread(connection,user,body):
    if not check_thread(connection,user,body):
        project=str(body.projectId) if body.projectId else None
        connection.execute('INSERT INTO uony_threads(user_id,id,project_id,title) VALUES(%s,%s,%s,%s)',(user['id'],body.threadId,project,body.text[:70]))


def routes(settings,database):
    router=APIRouter(prefix='/api/uony')

    @router.get('/projects')
    def projects(request:Request):
        with database.connect() as connection:
            user=require_user(connection,request)
            rows=connection.execute('SELECT id,name FROM uony_projects WHERE user_id=%s AND deleted_at IS NULL ORDER BY created_at,id',(user['id'],)).fetchall()
            return {'projects':[{'id':str(row['id']),'name':row['name']} for row in rows]}

    @router.post('/projects')
    def create(body:Project,request:Request):
        require_origin(request,settings.origin)
        with database.connect() as connection:
            user=require_user(connection,request)
            if not user.get('onboarding_completed_at') or workspace_access(connection,user)['status']!='allowed':
                raise HTTPException(403,detail={'error':'access_required','message':'Activa tu acceso a Uonify para crear proyectos.'})
            existing=connection.execute('SELECT name,deleted_at FROM uony_projects WHERE user_id=%s AND id=%s',(user['id'],body.id)).fetchone()
            if existing and existing['deleted_at']:
                raise HTTPException(410,detail={'error':'project_deleted','message':'Este proyecto se ha eliminado. Crea uno nuevo para continuar.'})
            if existing and existing['name']!=body.name:
                raise HTTPException(409,detail={'error':'project_conflict','message':'Este proyecto ya se guardó con otro nombre.'})
            if not existing:
                connection.execute('INSERT INTO uony_projects(user_id,id,name) VALUES(%s,%s,%s)',(user['id'],body.id,body.name))
            return {'id':str(body.id),'name':body.name}

    def erase_threads(connection,user,ids):
        # require_user bloquea la cuenta, igual que la reserva de nuevos mensajes.
        if connection.execute("SELECT 1 FROM uony_requests WHERE user_id=%s AND thread_id=ANY(%s) AND status='running'",(user['id'],ids)).fetchone():
            raise HTTPException(409,detail={'error':'thread_busy','message':'Espera a que Uony termine de responder antes de eliminar.'})
        if connection.execute('''SELECT 1 FROM uony_live_sessions
            WHERE user_id=%s AND thread_id=ANY(%s) AND expires_at>now()''',
            (user['id'], ids)).fetchone():
            raise HTTPException(409,detail={'error':'thread_busy',
                'message':'Termina la conversación por voz antes de eliminar este hilo.'})
        # Conservar IDs y contadores evita resurrecciones por reintento y saltarse cuotas.
        # El contenido de conversación y sus títulos sí se eliminan.
        connection.execute('DELETE FROM uony_structured_focus_expectations WHERE user_id=%s AND thread_id=ANY(%s)',
                           (user['id'], ids))
        connection.execute('DELETE FROM uony_semantic_requests WHERE user_id=%s AND thread_id=ANY(%s)',
                           (user['id'], ids))
        connection.execute('DELETE FROM uony_live_turns WHERE user_id=%s AND thread_id=ANY(%s)',
                           (user['id'], ids))
        connection.execute('DELETE FROM uony_live_usage WHERE user_id=%s AND thread_id=ANY(%s)',
                           (user['id'], ids))
        connection.execute('DELETE FROM uony_assignment_focus_requests WHERE user_id=%s AND thread_id=ANY(%s)',
                           (user['id'], ids))
        connection.execute('DELETE FROM uony_assignment_focus WHERE user_id=%s AND thread_id=ANY(%s)',
                           (user['id'], ids))
        # Preserve a confirmed product before deleting its originating intake.
        # A pending intake carries no product binding or permission to analyze.
        connection.execute('''UPDATE uony_assignments AS a
            SET product_id=COALESCE(a.product_id, CASE
                    WHEN i.status='linked' AND i.google_subject=a.google_subject
                    AND EXISTS (SELECT 1 FROM products AS p
                        WHERE p.user_id=a.user_id AND p.id=i.product_id
                        AND p.deleted_at IS NULL)
                    THEN i.product_id END),
                intake_id=NULL,version=a.version+1,updated_at=now()
            FROM uony_product_intakes AS i
            WHERE a.user_id=%s AND i.user_id=a.user_id AND i.id=a.intake_id
                AND i.thread_id=ANY(%s)''', (user['id'], ids))
        connection.execute('DELETE FROM uony_return_followups WHERE user_id=%s AND thread_id=ANY(%s)',
                           (user['id'], ids))
        connection.execute('DELETE FROM uony_creative_plans WHERE user_id=%s AND thread_id=ANY(%s)',
                           (user['id'], ids))
        connection.execute('DELETE FROM uony_thread_products WHERE user_id=%s AND thread_id=ANY(%s)',
                           (user['id'], ids))
        connection.execute('DELETE FROM uony_product_proposals WHERE user_id=%s AND thread_id=ANY(%s)',
                           (user['id'], ids))
        connection.execute('DELETE FROM uony_product_intakes WHERE user_id=%s AND thread_id=ANY(%s)', (user['id'], ids))
        connection.execute("""UPDATE uony_conversation_jobs SET payload='{}'::jsonb,
            memory_snapshot=NULL,project_id='',google_subject='',provisional_text='',
            assignment_focus_pinned=false,assignment_focus_id=NULL,
            assignment_focus_version=NULL
            WHERE user_id=%s AND thread_id=ANY(%s)""",
                           (user['id'],ids))
        connection.execute("""UPDATE uony_requests SET prompt='',reply=NULL,
            product_changes='[]',product_context=NULL,connection_actions='[]',
            conversation_form=NULL,form_response=NULL,material_analysis=NULL,
            material_action=NULL,product_intake=NULL,product_action=NULL,
            product_proposal=NULL,
            requirements_action=NULL,incident_action=NULL
            WHERE user_id=%s AND thread_id=ANY(%s)""",(user['id'],ids))
        connection.execute("UPDATE uony_threads SET deleted_at=COALESCE(deleted_at,now()),title='' WHERE user_id=%s AND id=ANY(%s)",(user['id'],ids))

    @router.delete('/threads/{thread_id}')
    def delete_thread(thread_id:str,request:Request):
        require_origin(request,settings.origin)
        with database.connect() as connection:
            user=require_user(connection,request)
            if not connection.execute('SELECT 1 FROM uony_threads WHERE user_id=%s AND id=%s',(user['id'],thread_id)).fetchone():
                raise HTTPException(404,detail={'error':'thread_not_found','message':'No se encuentra este hilo en tu cuenta.'})
            erase_threads(connection,user,[thread_id])
            return {'deleted':True,'threadIds':[thread_id]}

    @router.delete('/projects/{project_id}')
    def delete_project(project_id:UUID,request:Request):
        require_origin(request,settings.origin)
        with database.connect() as connection:
            user=require_user(connection,request)
            if not connection.execute('SELECT 1 FROM uony_projects WHERE user_id=%s AND id=%s',(user['id'],project_id)).fetchone():
                raise HTTPException(404,detail={'error':'project_not_found','message':'No se encuentra este proyecto en tu cuenta.'})
            rows=connection.execute('SELECT id FROM uony_threads WHERE user_id=%s AND project_id=%s',(user['id'],project_id)).fetchall()
            ids=[row['id'] for row in rows]
            erase_threads(connection,user,ids)
            connection.execute("UPDATE uony_projects SET deleted_at=COALESCE(deleted_at,now()),name='Proyecto eliminado' WHERE user_id=%s AND id=%s",(user['id'],project_id))
            return {'deleted':True,'threadIds':ids}
    return router

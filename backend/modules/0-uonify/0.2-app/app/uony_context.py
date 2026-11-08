"""Preparación compartida del contexto que Uony envía al modelo de conversación."""
import re
from uuid import UUID, uuid4
from fastapi import HTTPException
from pydantic import Field
from .onboarding import StrictBody
from .uony_models import Model, Effort, MODELS, options, resolve
from .google_account import require_same_connection
from .blender_tools import BusinessTools
from .products import find
from .product_memory import project as product_memory
from .uony_assignments import _assignment, _dtos, _focus, _linked_product
from .uony_written_failure import RETRY_LATER, previous_failure

HISTORY_LIMIT = 12
LIVE_FOCUS = object()
# Límites de entrada oficiales, comprobados el 15-10-2026. No son cuotas ni saldo.
MODEL_INPUT_LIMITS = {
    'gemini-3.5-flash': 1_048_576,
    'gemini-3.5-flash-lite': 1_048_576,
    'gemini-3.1-pro-preview': 1_048_576,
}
MODEL_LIMIT_SOURCES = {
    'gemini-3.5-flash': 'https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-5-flash',
    'gemini-3.5-flash-lite': 'https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-5-flash-lite?hl=en',
    'gemini-3.1-pro-preview': 'https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/guides/gemini-3-5-flash',
}


class ProductContext(StrictBody):
    sku: str = Field(min_length=1,max_length=80)
    revision: int = Field(ge=1)


class ContextRequest(StrictBody):
    threadId: str | None = Field(default=None,min_length=1,max_length=80,pattern=r'^[A-Za-z0-9_-]+$')
    text: str = Field(default='',max_length=3000)
    projectId: UUID | None = Field(default=None,strict=False)
    productContext: ProductContext | None = None
    model: Model = 'auto'
    effort: Effort = 'medium'


def cloud_selection(connection,user,model,effort):
    row=connection.execute('SELECT * FROM google_cloud_connections WHERE user_id=%s',(user['id'],)).fetchone()
    if row:
        require_same_connection(user,row)
    if not row or row['status']!='connected' or not row['project_id'] or not (row['project_check'] or {}).get('ready'):
        raise HTTPException(409,detail={'error':'google_required','message':'Conecta tu cuenta y proyecto de Google desde esta conversación para hablar con Uony.','connectionActions':[{'provider':'cloud','action':'manage'}]})
    selected,reason=resolve(model,effort,options(connection,user))
    return row,selected,reason


def _material_text(value, limit):
    if not isinstance(value, str):
        return None
    cleaned = re.sub(r'[\x00-\x1f\x7f]+', ' ', value).strip()
    return cleaned[:limit] if cleaned else None


def _saved_intake_analysis(connection, user, thread_id, intake_id,
                           assignment_id=None, job_id=None):
    """Only the selected pre-product intake may supply saved Drive observations."""
    row = connection.execute('''SELECT j.status,j.result,i.folder_metadata
        FROM product_material_jobs j JOIN uony_product_intakes i
          ON i.user_id=j.user_id AND i.id=j.intake_id
          AND i.google_subject=j.google_subject AND i.folder_id=j.folder_id
        JOIN uony_threads t ON t.user_id=i.user_id AND t.id=i.thread_id
        WHERE j.user_id=%s AND j.google_subject=%s AND j.intake_id=%s
          AND j.product_id IS NULL AND i.thread_id=%s AND i.status='identified'
          AND t.deleted_at IS NULL AND (%s::uuid IS NULL OR EXISTS (
            SELECT 1 FROM uony_assignment_material_jobs link
            WHERE link.user_id=j.user_id AND link.google_subject=j.google_subject
              AND link.material_job_id=j.id AND link.intake_id=j.intake_id
              AND link.assignment_id=%s::uuid))
          AND (%s::uuid IS NULL OR j.id=%s::uuid)
        ORDER BY j.created_at DESC,j.id DESC LIMIT 1''',
        (user['id'],user['google_subject'],intake_id,thread_id,
         assignment_id,assignment_id,job_id,job_id)).fetchone()
    if not row:
        return None
    folder = row['folder_metadata'] if isinstance(row['folder_metadata'], dict) else {}
    saved = {'status': row['status'],
             'folderName': _material_text(folder.get('name'), 120) or 'Carpeta de Drive'}
    if row['status'] != 'ready':
        return saved
    result = row['result'] if isinstance(row['result'], dict) else {}
    sources = result.get('sources') if isinstance(result.get('sources'), list) else []
    observations = []
    for source in sources:
        if not isinstance(source, dict):
            continue
        name = _material_text(source.get('name'), 120)
        summary = _material_text(source.get('summary'), 360)
        if name and summary:
            observations.append({'source': name, 'summary': summary})
        if len(observations) == 8:
            break
    proposals = result.get('proposals') if isinstance(result.get('proposals'), list) else []
    candidates = []
    for proposal in proposals:
        if not isinstance(proposal, dict):
            continue
        label = _material_text(proposal.get('label'), 100)
        value = _material_text(proposal.get('value'), 180)
        if label and value:
            candidates.append({'label': label, 'value': value})
        if len(candidates) == 10:
            break
    saved.update(observations=observations, candidateFacts=candidates,
                 sourcesTotal=result.get('total') if type(result.get('total')) is int
                     and 0 <= result['total'] <= 100000 else None)
    return saved


def conversation_context(connection,user,body,database,service_status,incidents=None,materials=None,
                         assignment_focus=LIVE_FOCUS):
    active=body.productContext.model_dump() if body.productContext else None
    intake_state=None
    intake_id=None
    intake_started=None
    binding=None
    deleted_product_cutoff=None
    if body.threadId:
        thread=connection.execute('''SELECT product_history_cutoff_at FROM uony_threads
            WHERE user_id=%s AND id=%s AND deleted_at IS NULL''',
            (user['id'],body.threadId)).fetchone()
        deleted_product_cutoff=thread['product_history_cutoff_at'] if thread else None
        binding=connection.execute('''SELECT google_subject,updated_at FROM uony_thread_products
            WHERE user_id=%s AND thread_id=%s''',(user['id'],body.threadId)).fetchone()
        intake=connection.execute('''SELECT i.id,i.status,i.folder_metadata,i.created_at,
            p.sku,p.revision,p.data->>'name' AS name
            FROM uony_product_intakes i JOIN uony_threads t ON t.user_id=i.user_id AND t.id=i.thread_id
            LEFT JOIN products p ON p.user_id=i.user_id AND p.id=i.product_id AND p.deleted_at IS NULL
            WHERE i.user_id=%s AND i.thread_id=%s AND i.google_subject=%s AND t.deleted_at IS NULL
            ORDER BY i.created_at DESC LIMIT 1''',(user['id'],body.threadId,user['google_subject'])).fetchone()
        if intake:
            intake_id=intake['id']
            intake_started=intake['created_at'] if intake['status']!='linked' else None
            intake_state={'status':intake['status'],'folder':intake['folder_metadata'],
                'product':{'sku':intake['sku'],'revision':intake['revision'],'name':intake['name']} if intake['sku'] else None}
            if intake['status']=='linked' and not intake['sku']:
                intake_state['productUnavailable']=True
    memory=product_memory(connection,user,body.threadId)
    if intake_state and intake_state['status']!='linked':
        # A pending intake has not identified a product yet. An editor tab is not
        # consent to select one while this conversation asks for materials.
        memory=None
        active=None
    elif memory:
        # The explicit thread link wins over a transient editor selection,
        # including a stale revision of the same product.
        active={'sku':memory['product']['sku'],'revision':memory['product']['revision']}
    elif active:
        find(connection,user,active['sku'])
    rows=[]
    voice_rows=[]
    failed=None
    same_subject=not binding or binding['google_subject']==user['google_subject']
    if body.threadId and same_subject:
        boundary=max((stamp for stamp in (binding['updated_at'] if binding else None,
                                           intake_started,deleted_product_cutoff)
                      if stamp is not None),default=None)
        sql="""SELECT CASE WHEN h.request_id IS NOT NULL
                THEN COALESCE(j.finished_at,r.created_at) ELSE r.created_at END AS created_at,
            r.prompt,r.reply,
            h.request_id IS NOT NULL AS from_live
            FROM uony_requests r LEFT JOIN uony_live_handoffs h
              ON h.user_id=r.user_id AND h.request_id=r.request_id
            LEFT JOIN uony_conversation_jobs j
              ON j.user_id=r.user_id AND j.request_id=r.request_id
            WHERE r.user_id=%s AND r.thread_id=%s AND r.status='success'"""
        params=[user['id'],body.threadId]
        if boundary:
            sql+=' AND r.created_at >= %s'
            params.append(boundary)
        rows=connection.execute(sql+' ORDER BY r.created_at DESC LIMIT 12',params).fetchall()
        # Lote 6 (point 5, «Consultor google»): the customer's answer to RETRY_LATER needs the
        # failed turn it answers; only the immediately previous one, as prompt and capa 2's text.
        failed=previous_failure(connection,user['id'],body.threadId,getattr(body,'requestId',None))
        if failed and (not boundary or failed['createdAt']>=boundary):
            rows=[*rows,{'created_at':failed['createdAt'],'prompt':failed['prompt'],
                         'reply':RETRY_LATER,'from_live':False}]
        voice_sql='''SELECT v.created_at,v.role,v.text,v.session_id,v.turn_id
            FROM uony_live_turns v WHERE v.user_id=%s AND v.thread_id=%s
            AND NOT (v.role='assistant' AND v.reply_to_turn_id IS NOT NULL
                AND EXISTS (SELECT 1 FROM uony_live_handoffs h
                    WHERE h.user_id=v.user_id AND h.thread_id=v.thread_id
                      AND h.session_id=v.session_id AND h.turn_id=v.reply_to_turn_id))'''
        voice_params=[user['id'],body.threadId]
        if boundary:
            voice_sql+=' AND created_at >= %s'
            voice_params.append(boundary)
        voice_rows=connection.execute(voice_sql+' ORDER BY created_at DESC LIMIT 24',
                                      voice_params).fetchall()
        # The current worker already receives body.text as its newest user
        # message. Never feed the same final Live turn twice to Gemini.
        source=connection.execute('''SELECT session_id,turn_id FROM uony_live_handoffs
            WHERE user_id=%s AND request_id=%s''',
            (user['id'], getattr(body,'requestId',None))).fetchone()
        if source:
            voice_rows=[row for row in voice_rows if not (
                row['role']=='user' and row['session_id']==source['session_id']
                and row['turn_id']==source['turn_id'])]
    context=BusinessTools({key:value for key,value in service_status.items() if not key.endswith('Email')},
                          database,user,active,getattr(body,'requestId',None) or uuid4(),
                          incidents=incidents,materials=materials,thread_id=body.threadId,user_text=body.text)
    if intake_state and (not memory or intake_state['status']!='linked' or
                         intake_state['product'] and intake_state['product']['sku']==memory['product']['sku']):
        context['productIntake']=intake_state
    if memory:
        context['productMemory']=memory
    if failed:
        context['retryOf']=failed  # Only the Drive emitter reads it (the customer's own words).
    # An old, unpinned queued job receives no goal. New jobs and read-only
    # token counts use only the explicitly selected goal for this exact thread.
    if body.threadId and assignment_focus is not None:
        focus=_focus(connection,user,body.threadId)
        current=(focus['assignment_id'],focus['version']) if focus else (None,0)
        if assignment_focus is not LIVE_FOCUS and current!=assignment_focus:
            raise HTTPException(409,detail={'error':'assignment_focus_conflict',
                'message':'El encargo seleccionado cambió. Revisa cuál quieres continuar.'})
        if focus:
            assignment=_assignment(connection,user,focus['assignment_id'])
            product=_linked_product(connection,user,assignment)
            saved=_dtos(connection,user,[assignment])[0]
            context_product=active['sku'] if active else (
                (intake_state or {}).get('product') or {}).get('sku')
            intake_conflict=bool(intake_id and intake_id!=assignment['intake_id'])
            context['assignmentFocus']={
                'id':saved['id'],'label':saved['label'],'objective':saved['objective'],
                'status':saved['status'],'nextStep':saved['nextStep'],
                'product':({'id':str(product['id']),'sku':product['sku'],
                            'revision':product['revision']} if product else None),
                'productConflict':bool(intake_conflict or context_product and (
                    not product or context_product!=product['sku']))}
            if intake_conflict:
                context.pop('productIntake',None)
            # Previous turns may describe a different goal or product. Preserve
            # only turns after this explicit focus choice, even if unlinked.
            rows=[row for row in rows if row['created_at']>=focus['updated_at']]
            voice_rows=[row for row in voice_rows if row['created_at']>=focus['updated_at']]
    selected_goal=context.get('assignmentFocus') or {}
    if (body.threadId and intake_id and intake_state
            and intake_state['status']=='identified'
            and not selected_goal.get('productConflict')):
        analysis=_saved_intake_analysis(connection,user,body.threadId,intake_id,
                                        selected_goal.get('id'))
        if analysis:
            context['materialIntakeResult']=analysis
    turns=[]
    for row in rows:
        if not row['from_live']:
            turns.append((row['created_at'],0,'user',row['prompt']))
        turns.append((row['created_at'],1,'model',row['reply']))
    for row in voice_rows:
        turns.append((row['created_at'],0 if row['role']=='user' else 1,
                      'user' if row['role']=='user' else 'model',row['text']))
    turns.sort(key=lambda item:(item[0],item[1]))
    history=[{'role':role,'parts':[{'text':text}]} for _,_,role,text in
             turns[-HISTORY_LIMIT*2:] if text]
    history_turns=(len(history)+1)//2
    if body.text:
        history.append({'role':'user','parts':[{'text':body.text}]})
    return history,context,history_turns


def model_label(model):
    return next((item['label'] for item in MODELS if item['id']==model),model)

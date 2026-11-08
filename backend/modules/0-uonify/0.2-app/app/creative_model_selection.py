"""Persist a customer's exact video-model choice without another model call."""
from fastapi import HTTPException
from psycopg.types.json import Jsonb

from .creative_planning import (VIDEO_MODEL_LABELS, PlanInput, latest,
                                model_choice_form, response, route)


def submit_if_answer(connection, user, body):
    saved = connection.execute('''SELECT request_id,conversation_form FROM uony_requests
        WHERE user_id=%s AND thread_id=%s AND status='success'
        ORDER BY created_at DESC LIMIT 1''', (user['id'], body.threadId)).fetchone()
    form = saved['conversation_form'] if saved else None
    if not isinstance(form, dict) or form.get('title') != 'Elige el modelo de vídeo':
        return None
    current = latest(connection, user, body.threadId)
    expected = model_choice_form(current) if current else None
    if not expected or form.get('id') != str(saved['request_id']) or \
            form.get('fields') != expected['fields']:
        return None
    field = expected['fields'][0]
    prefix = f"{expected['title']}\n{field['label']}: "
    if not body.text.startswith(prefix):
        return None
    selected_label = body.text[len(prefix):].strip()
    labels = {label: model for model, label in VIDEO_MODEL_LABELS.items()}
    if selected_label not in field['options'] or selected_label not in labels:
        raise HTTPException(422, detail={'error':'invalid_model_choice',
            'message':'Elige uno de los modelos compatibles de esta pregunta.'})
    if not current['projectCurrent'] or not current['productCurrent']:
        raise HTTPException(409, detail={'error':'creative_plan_stale',
            'message':'El proyecto o la ficha del plan ha cambiado. Pide a Uony que actualice el plan.'})
    model = labels[selected_label]
    plan_input = {key: value for key, value in current['plan'].items()
                  if key in PlanInput.model_fields}
    plan_input['modelChoice'] = model
    validated = PlanInput.model_validate(plan_input).model_dump()
    chosen_model = route(current['recipe'], _plan_project(connection, user, current['id']), model)
    stored = {**current['plan'], **validated, 'modelSnapshot': chosen_model}
    changed = connection.execute('''UPDATE uony_creative_plans SET plan=%s,revision=revision+1
        WHERE id=%s AND user_id=%s AND google_subject=%s AND thread_id=%s
        AND origin_request_id=%s AND revision=%s
        AND plan->>'modelChoice' IS NULL RETURNING id''',
        (Jsonb(stored), current['id'], user['id'], user['google_subject'],
         body.threadId, saved['request_id'], current['revision'])).fetchone()
    if not changed:
        raise HTTPException(409, detail={'error':'creative_plan_changed',
            'message':'El plan cambió. Revisa el último mensaje antes de elegir el modelo.'})
    updated = {**current, 'plan':stored, 'model':chosen_model,
               'revision':current['revision']+1}
    reply = response(updated)
    usage = {'calls':0, 'totalTokenCount':0}
    reason = 'Elección expresa del modelo de vídeo; sin llamada a Google ni generación multimedia'
    connection.execute('''INSERT INTO uony_requests
        (user_id,request_id,thread_id,prompt,status,model,project_id,
         requested_model,effort,selection_reason,product_context,reply,usage,
         product_changes,connection_actions)
        VALUES(%s,%s,%s,%s,'success','uonify-creative','uonify-creative',
         %s,%s,%s,%s,%s,%s,%s,%s)''',
        (user['id'],body.requestId,body.threadId,body.text,body.model,body.effort,
         reason,Jsonb(body.productContext.model_dump()) if body.productContext else None,
         reply,Jsonb(usage),Jsonb([]),Jsonb([])))
    return {'reply':reply,'model':'uonify-creative','effort':body.effort,
            'selectionReason':reason,'productChanges':[],
            'connectionActions':[],'conversationForm':None}


def _plan_project(connection, user, plan_id):
    row = connection.execute('''SELECT project_id FROM uony_creative_plans
        WHERE id=%s AND user_id=%s AND google_subject=%s''',
        (plan_id,user['id'],user['google_subject'])).fetchone()
    if not row:
        raise HTTPException(409,detail={'error':'creative_plan_stale'})
    return row['project_id']

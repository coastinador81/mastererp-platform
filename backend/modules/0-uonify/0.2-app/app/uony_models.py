"""Catálogo permitido y selección determinista; nunca cambia de pagador."""
from typing import Literal
from fastapi import HTTPException
from .google_account import connection_matches
from .onboarding import StrictBody

Effort = Literal['low','medium','high']
Model = Literal['auto','gemini-3.5-flash','gemini-3.5-flash-lite','gemini-3.1-pro-preview']
FLASH='gemini-3.5-flash'
LITE='gemini-3.5-flash-lite'
PRO='gemini-3.1-pro-preview'
MODELS=[
 {'id':FLASH,'label':'Gemini 3.5 Flash','short':'Flash','detail':'Trabajo habitual y herramientas de Uony'},
 {'id':LITE,'label':'Gemini 3.5 Flash-Lite','short':'Flash-Lite','detail':'Tareas sencillas y respuestas ágiles'},
 {'id':PRO,'label':'Gemini 3.1 Pro · Preview','short':'Pro','detail':'Análisis complejo · elección manual; tarifa propia de Google'},
]
EFFORTS=[{'id':'low','label':'Bajo'},{'id':'medium','label':'Medio'},{'id':'high','label':'Alto'}]
POLICY='Auto usa Flash-Lite en Bajo y Flash en Medio o Alto. Si esa opción no está comprobada, usa Flash. Pro solo se elige manualmente. No cambia de modelo tras un error.'

class Preferences(StrictBody):
    model: Model = 'auto'
    effort: Effort = 'medium'


def options(connection,user):
    cloud=connection.execute('SELECT status,project_id,google_subject,project_check FROM google_cloud_connections WHERE user_id=%s',(user['id'],)).fetchone()
    rows=[]
    if connection_matches(user, cloud) and cloud['status']=='connected' and (cloud['project_check'] or {}).get('ready'):
        rows=connection.execute("SELECT model,effort FROM uony_model_checks WHERE user_id=%s AND project_id=%s AND google_subject=%s",(user['id'],cloud['project_id'],cloud['google_subject'])).fetchall()
    models=[{**m,'efforts':[e['id'] for e in EFFORTS if any(r['model']==m['id'] and r['effort']==e['id'] for r in rows)]} for m in MODELS]
    models=[m for m in models if m['efforts']]
    saved=connection.execute('SELECT model,effort FROM uony_preferences WHERE user_id=%s',(user['id'],)).fetchone()
    return {'models':models,'efforts':EFFORTS,'preferences':saved or {'model':'auto','effort':'medium'},'autoPolicy':POLICY}


def resolve(model,effort,catalog):
    allowed={m['id']:m['efforts'] for m in catalog['models']}
    actual=model
    reason='Elección manual'
    if model=='auto':
        actual=LITE if effort=='low' and effort in allowed.get(LITE,[]) else FLASH
        reason='Auto: tarea ágil con Flash-Lite' if actual==LITE else 'Auto: trabajo general con Flash'
    if effort not in allowed.get(actual,[]):
        raise HTTPException(409,detail={'error':'model_not_checked','message':'Esta combinación de modelo y razonamiento no está comprobada en tu cuenta. Elige una opción disponible.'})
    return actual,reason

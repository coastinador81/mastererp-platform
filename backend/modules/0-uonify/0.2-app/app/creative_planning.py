"""Recetas privadas Higgsfield→Google: planificación, nunca generación."""
from uuid import uuid4
from math import ceil

from typing import Literal

from pydantic import Field, ValidationError, model_validator
from psycopg.types.json import Jsonb
from .creative_google_capabilities import (
    ModelId, ga_models_with_verified_mode, model_label, veo_model_ids)
from .onboarding import StrictBody

SKILL_VERSION = 'create-ads-with-agents/google-1.3.0+source-2.1.2'
SOURCE_SHA256 = '5f5a849986b52c9d4649865bdd06074f0f5550e910b7d623084a407e692ebfc0'
AUDITED_PROJECT = 'uonify-757ec8c3ab3245ffa45d'
RECIPES = {
    'product_diagram': ('Diagrama de producto', ModelId.FLASH_IMAGE.value, 'imagen'),
    'review_card': ('Reseña auténtica', ModelId.FLASH_IMAGE.value, 'imagen'),
    'product_offer': ('Oferta de producto', ModelId.FLASH_IMAGE.value, 'imagen'),
    'quiz': ('Cuestionario', ModelId.FLASH_IMAGE.value, 'imagen'),
    'case_study': ('Caso documentado', ModelId.FLASH_IMAGE.value, 'imagen'),
    'service_offer': ('Oferta de servicio', ModelId.FLASH_IMAGE.value, 'imagen'),
    'ugc_video': ('Vídeo UGC', ModelId.VEO_31_FAST.value, 'vídeo'),
    'cinematic_video': ('Vídeo cinematográfico', ModelId.VEO_31.value, 'vídeo'),
    'reference_video': ('Vídeo con referencias', ModelId.VEO_31_FAST.value, 'vídeo'),
}
COMMERCIAL_RECIPES = frozenset({'review_card', 'product_offer', 'quiz',
                                'case_study', 'service_offer'})
# B1 (hallazgo ROJO de REA / bandera del Consultor): los motores ofertables para CLIPS
# COMERCIALES se DERIVAN del catálogo por capacidad de vídeo Y launch_stage=GA; jamás se cablea un
# id a mano. Omni queda excluido por doble motivo (es Preview y sus modos de vídeo son
# contract_only → no entra por ninguna vía). Si el catálogo cambiara e introdujera un motor no-GA
# o no-Veo, el assert falla al importar (fail-closed).
VIDEO_MODELS = tuple(sorted(
    (ga_models_with_verified_mode('text_to_video')
     | ga_models_with_verified_mode('reference_image_to_video'))
    & veo_model_ids()))
assert VIDEO_MODELS and set(VIDEO_MODELS) <= veo_model_ids(), (
    'Los motores de clips comerciales deben ser Veo en GA del catálogo (B1).')
VIDEO_MODEL_LABELS = {model: model_label(model) for model in VIDEO_MODELS}

# Observaciones mínimas del proyecto auditado, no garantía de disponibilidad futura.
# Las referencias verificadas son entradas; no prueban fidelidad comercial.
PROJECT_OBSERVATIONS = {
    ModelId.VEO_31_FAST: {
        'modes': ['text_to_video', 'reference_to_video'],
        'referenceInputs': ['subject_images'],
        'endpoint': 'us-central1/v1/predictLongRunning',
        'evidence': [f'google-results/{ModelId.VEO_31_FAST.value}-poll-1792279452.json',
                     'google-results/veo-fast-subject-image.json'],
    },
    ModelId.VEO_31: {
        'modes': ['text_to_video'], 'referenceInputs': [],
        'endpoint': 'us-central1/v1/predictLongRunning',
        'evidence': [f'google-results/{ModelId.VEO_31.value}-poll-1792279454.json'],
    },
}


class ReferenceNeed(StrictBody):
    role: Literal['product', 'identity', 'location', 'first_frame', 'motion']
    kind: Literal['image', 'video']
    description: str = Field(min_length=3, max_length=160)
    required: bool = True

class PlanInput(StrictBody):
    recipe: str
    objective: str = Field(min_length=8, max_length=400)
    audience: str | None = Field(default=None, min_length=3, max_length=300)
    offer: str | None = Field(default=None, min_length=3, max_length=300)
    sourceMode: Literal['provided', 'uony_concept', 'undecided'] = 'undecided'
    modelChoice: str | None = None
    evidence: str | None = Field(default=None, max_length=300)
    cta: str | None = Field(default=None, max_length=120)
    assetNeeds: list[str] = Field(default_factory=list, max_length=8)
    referenceNeeds: list[ReferenceNeed] = Field(default_factory=list, max_length=8)
    durationSeconds: int | None = Field(default=None, ge=3, le=120)

    @model_validator(mode='after')
    def valid(self):
        if self.recipe not in RECIPES:
            raise ValueError('Formato creativo desconocido.')
        if self.recipe in COMMERCIAL_RECIPES and (not self.audience or not self.offer):
            raise ValueError('Una pieza comercial necesita público y oferta verificables.')
        medium = RECIPES[self.recipe][2]
        if self.modelChoice and medium != 'vídeo':
            raise ValueError('Esta elección de motor corresponde a un vídeo.')
        if self.modelChoice is not None and self.modelChoice not in VIDEO_MODELS:
            raise ValueError('Motor de vídeo desconocido.')
        model = self.modelChoice or RECIPES[self.recipe][1]
        if self.durationSeconds and RECIPES[self.recipe][2] != 'vídeo':
            raise ValueError('La duración solo corresponde a un vídeo.')
        if any(not isinstance(value, str) or not 2 <= len(value) <= 120 for value in self.assetNeeds):
            raise ValueError('Recurso no válido.')
        if self.referenceNeeds and RECIPES[self.recipe][2] != 'vídeo':
            raise ValueError('Estas referencias corresponden a un vídeo.')
        if any(ref.role == 'motion' and ref.kind != 'video' or
               ref.role == 'first_frame' and ref.kind != 'image' for ref in self.referenceNeeds):
            raise ValueError('Función y tipo de referencia incompatibles.')
        # B1: ningún motor GA de clips comerciales sirve referencias de CLIP de vídeo (eso solo lo
        # hacía Omni, Preview + contract_only). La referencia va por imagen o primer fotograma
        # (Veo 3.1 Fast). Fail-closed: se rechaza el clip de vídeo como referencia.
        if any(ref.kind == 'video' for ref in self.referenceNeeds):
            raise ValueError('Una referencia de clip de vídeo no está disponible; usa una imagen '
                             'o un primer fotograma.')
        if model.startswith('veo-') and any(
                ref.role not in ('product', 'identity', 'first_frame') for ref in self.referenceNeeds):
            raise ValueError('Veo requiere imagen de sujeto o primer fotograma.')
        if model.startswith('veo-') and len(self.referenceNeeds) > 3:
            raise ValueError('Veo admite hasta tres imágenes de sujeto.')
        if model.startswith('veo-') and any(
                ref.role == 'first_frame' for ref in self.referenceNeeds) and len(self.referenceNeeds) > 1:
            raise ValueError('El primer fotograma se planifica separado de imágenes de sujeto.')
        if len([ref for ref in self.referenceNeeds if ref.role == 'first_frame']) > 1:
            raise ValueError('Solo se admite un primer fotograma.')
        return self

DECLARATIONS = [{
    'name': 'prepare_creative_plan',
    'description': 'Guarda en el hilo un plan creativo revisable sin generar ni gastar en medios. Antes pregunta qué pieza quiere hacer y si aporta materiales o prefiere creatividad desde cero; no requiere ficha de producto. Una pieza comercial necesita público y oferta, un vídeo libre no. Nunca inventes reseñas, resultados ni características.',
    'parameters': {'type':'OBJECT','properties': {
        'recipe': {'type':'STRING','enum':list(RECIPES)},
        'objective': {'type':'STRING'}, 'audience': {'type':'STRING'},
        'offer': {'type':'STRING'}, 'evidence': {'type':'STRING'},
        'cta': {'type':'STRING'},
        'sourceMode': {'type':'STRING','enum':['provided','uony_concept','undecided'],
                       'description':'provided: materiales del cliente; uony_concept: creatividad desde cero; undecided: aún no se ha elegido.'},
        'modelChoice': {'type':'STRING','enum':list(VIDEO_MODELS),
                        'description':'Motor de vídeo elegido expresamente por el cliente; omitir si solo es una recomendación.'},
        'assetNeeds': {'type':'ARRAY','items':{'type':'STRING'}},
        'referenceNeeds': {'type':'ARRAY','description':'Referencias necesarias, aún sin archivo vinculado. Son imágenes o un primer fotograma (Veo 3.1 Fast); no se admiten clips de vídeo como referencia.',
            'items': {'type':'OBJECT','properties':{
                'role':{'type':'STRING','enum':['product','identity','location','first_frame','motion']},
                'kind':{'type':'STRING','enum':['image','video']},
                'description':{'type':'STRING'},'required':{'type':'BOOLEAN'}},
                'required':['role','kind','description']}},
        'durationSeconds': {'type':'INTEGER','description':'Duración total en segundos si la ha pedido el cliente; entre 3 y 120.'},
    }, 'required':['recipe','objective']},
}, {
    'name': 'get_creative_plan',
    'description': 'Consulta el último plan creativo guardado en este mismo hilo, con su versión y vigencia. No ejecuta generación.',
    'parameters': {'type':'OBJECT','properties':{}},
}]

def route(recipe, project_id=None, model_choice=None):
    label, recommended, medium = RECIPES[recipe]
    model = model_choice or recommended
    observation = PROJECT_OBSERVATIONS.get(model) if project_id == AUDITED_PROJECT else None
    verification = ('salida mínima observada el 18-10-2026 en este proyecto; disponibilidad actual y calidad final pendientes'
                    if project_id == AUDITED_PROJECT else 'pendiente de comprobar en este proyecto')
    if model == ModelId.VEO_31_FAST and observation:
        verification = ('salida mínima de texto y de imagen de sujeto observada el 18-10-2026; '
                        'fidelidad comercial y disponibilidad actual pendientes')
    return {'label':label,'model':model,'medium':medium,
            'selectionStatus':('selected' if model_choice else
                               'recommendation' if medium == 'vídeo' else 'fixed'),
            'verification':verification,
            'observedOnProject':project_id == AUDITED_PROJECT,
            'observedAt':'2026-10-18' if project_id == AUDITED_PROJECT else None,
            'observedModes':observation['modes'] if observation else [],
            'observedReferenceInputs':observation['referenceInputs'] if observation else [],
            'observedEndpoint':observation['endpoint'] if observation else None,
            'evidence':observation['evidence'] if observation else [],
            'fallback':None}

def latest(connection, user, thread_id):
    row = connection.execute('''SELECT p.*,products.revision AS current_revision,
        cloud.project_id AS current_project
        FROM uony_creative_plans p LEFT JOIN products ON products.user_id=p.user_id
        AND products.id=p.product_id AND products.deleted_at IS NULL
        LEFT JOIN google_cloud_connections cloud ON cloud.user_id=p.user_id
        AND cloud.google_subject=p.google_subject AND cloud.status='connected'
        WHERE p.user_id=%s AND p.google_subject=%s AND p.thread_id=%s
        ORDER BY p.created_at DESC,p.id DESC LIMIT 1''',
        (user['id'],user['google_subject'],thread_id)).fetchone()
    if not row:
        return None
    snapshot = row['plan'].get('modelSnapshot')
    return {'id':str(row['id']), 'revision':row['revision'],
            'recipe':row['recipe'], 'plan':row['plan'],
            'model':snapshot if isinstance(snapshot, dict) else route(
                row['recipe'],row['project_id'],row['plan'].get('modelChoice')),
            'skillVersion':row['skill_version'],
            'sourceSha256':row['plan'].get('sourceSha256',SOURCE_SHA256),
            'productCurrent':row['product_id'] is None or row['product_revision']==row['current_revision'],
            'projectCurrent':row['project_id']==row['current_project'],
            'productBound':row['product_id'] is not None,
            'spendLimitUsd':str(row['spend_limit_usd']), 'status':row['status']}

class CreativeTools:
    def __init__(self, database, user, thread_id, request_id, active, project_id):
        self.database, self.user = database, user
        self.thread_id, self.request_id = thread_id, request_id
        self.active, self.project_id = active, project_id
        self.prepared = None

    def call(self, name, args):
        if name == 'get_creative_plan':
            if args != {}:
                return {'error':'invalid_tool','message':'Esta consulta no recibe argumentos.'}
            with self.database.connect() as connection:
                return {'creativePlan':latest(connection,self.user,self.thread_id)}
        try:
            candidate = PlanInput.model_validate(args).model_dump()
        except (ValidationError, ValueError, TypeError):
            return {'error':'invalid_tool','message':'Indica formato y objetivo; en piezas comerciales, también público y oferta verificables.'}
        if self.prepared and self.prepared != candidate:
            return {'error':'one_plan','message':'Este turno ya tiene un plan preparado.'}
        self.prepared = candidate
        return {'prepared':True,'model':route(candidate['recipe'],self.project_id,
                                              candidate['modelChoice']),
                'message':'El plan se guardará como borrador, sin generar medios ni autorizar gasto.'}

    def commit(self, connection, user):
        if not self.prepared:
            return None
        product = None
        if self.active:
            product = connection.execute('''SELECT id,revision FROM products
                WHERE user_id=%s AND sku=%s AND deleted_at IS NULL''',
                (user['id'],self.active['sku'])).fetchone()
            if not product or product['revision'] != self.active['revision']:
                raise ValueError('La ficha cambió antes de guardar el plan.')
        model = route(self.prepared['recipe'],self.project_id,
                      self.prepared['modelChoice'])
        stored_plan = {**self.prepared, 'modelSnapshot':model, 'sourceSha256':SOURCE_SHA256}
        connection.execute('''SELECT pg_advisory_xact_lock(
            hashtextextended(%s::text || ':' || %s,0))''',
            (user['id'],self.thread_id)).fetchone()
        row = connection.execute('''INSERT INTO uony_creative_plans
            (user_id,id,google_subject,project_id,thread_id,origin_request_id,
             product_id,product_revision,skill_version,recipe,plan)
            VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (user_id,origin_request_id) DO NOTHING RETURNING id''',
            (user['id'],uuid4(),user['google_subject'],self.project_id,self.thread_id,
             self.request_id,product['id'] if product else None,
             product['revision'] if product else None,SKILL_VERSION,
             self.prepared['recipe'],Jsonb(stored_plan))).fetchone()
        if not row:
            raise ValueError('Ya existe un plan para esta petición.')
        return {'id':str(row['id']),'revision':1,'recipe':self.prepared['recipe'],
                'model':model, 'plan':stored_plan,
                'skillVersion':SKILL_VERSION,'spendLimitUsd':'0.00','status':'draft',
                'productBound':product is not None}

def compatible_video_models(plan):
    if plan['model'].get('medium') != 'vídeo' or not plan['model'].get('observedOnProject'):
        return []
    refs = plan['plan'].get('referenceNeeds', [])
    needs_clip = any(ref['kind'] == 'video' for ref in refs)
    has_images = any(ref['kind'] == 'image' for ref in refs)
    options = []
    for model in VIDEO_MODELS:
        inputs = PROJECT_OBSERVATIONS.get(model, {}).get('referenceInputs', [])
        if needs_clip and 'image+video' not in inputs:
            continue
        if has_images and not needs_clip and not inputs:
            continue
        if has_images and not needs_clip and model.startswith('veo-') and any(
                ref['role'] not in ('product','identity','first_frame') for ref in refs):
            continue
        options.append(model)
    return options

def model_choice_form(plan):
    if plan['plan'].get('modelChoice'):
        return None
    options = compatible_video_models(plan)
    if not options:
        return None
    return {'title':'Elige el modelo de vídeo', 'fields':[{
        'id':'video_model', 'label':'¿Con qué modelo quieres crear este vídeo?',
        'type':'select', 'required':True,
        'options':[VIDEO_MODEL_LABELS[model] for model in options]}]}

def response(plan, *, model_question_visible=True):
    recipe = plan['model']
    data = plan['plan']
    medium = recipe.get('medium') or RECIPES[plan['recipe']][2]
    missing = []
    if plan['recipe'] == 'review_card' and not data.get('evidence'):
        missing.append('una reseña auténtica')
    if plan['recipe'] == 'case_study' and not data.get('evidence'):
        missing.append('resultados documentados del caso')
    if medium == 'vídeo' and not data.get('modelChoice'):
        missing.append('elegir el modelo de vídeo antes de calcular el coste y generar')
    refs = data.get('referenceNeeds', [])
    if refs:
        missing.append('vincular los archivos reales a las referencias del plan')
    if plan['recipe'] == 'reference_video' and not refs:
        missing.append('qué imágenes o clips servirán de referencia')
    if (refs or plan['recipe'] == 'reference_video') and not recipe.get('observedReferenceInputs'):
        provider = 'Veo'
        missing.append(f'validación de referencias con {provider} en este proyecto')
    needs = (', '.join(data['assetNeeds']) if data['assetNeeds'] else
             'por diseñar con Uony' if data.get('sourceMode') == 'uony_concept' else
             'por definir según los recursos ya autorizados')
    duration = data.get('durationSeconds')
    roles = {'product':'producto','identity':'identidad','location':'escenario',
             'first_frame':'primer fotograma','motion':'movimiento'}
    kinds = {'image':'imagen','video':'vídeo'}
    reference_summary = (' Referencias previstas: ' + ', '.join(
        f"{ref['description']} ({roles[ref['role']]}, {kinds[ref['kind']]})" for ref in refs) + '.' if refs else '')
    maximum = 8
    if duration and duration > maximum:
        montage = (f"Duración solicitada: {duration} segundos; por el límite documentado de {maximum} segundos "
                   f"por salida, harán falta al menos {ceil(duration/maximum)} planos y un montaje. "
                   'No se presupone continuidad automática. ')
    elif duration:
        montage = (f"Duración solicitada: {duration} segundos; cabe en el límite documentado "
                   f"de {maximum} segundos por salida, pero esa duración concreta aún debe probarse. ")
    else:
        montage = ''
    source = {'provided':'Materiales: aportarás tus fotos o clips. ',
              'uony_concept':'Materiales: propuesta creativa desde cero, sin archivos tuyos. ',
              'undecided':'Materiales: aún falta elegir si aportarás archivos o partimos desde cero. '}
    audience = f"Público: {data['audience']}. " if data.get('audience') else ''
    offer = f"Oferta: {data['offer']}. " if data.get('offer') else ''
    model_label = ('Modelo elegido' if data.get('modelChoice') else
                   'Modelo sugerido, pendiente de tu elección' if medium == 'vídeo' else
                   'Motor candidato')
    model_question = ''
    if medium == 'vídeo' and not data.get('modelChoice'):
        options = [VIDEO_MODEL_LABELS[model] for model in compatible_video_models(plan)]
        if len(options) > 1:
            model_question = ('¿Con qué modelo prefieres generar este vídeo: '
                              + ', '.join(options[:-1]) + ' u ' + options[-1]
                              + '? La elección concreta determinará el coste máximo a revisar. ')
        elif options:
            model_question = (f'Con estas referencias, la ruta que hemos comprobado es {options[0]}. '
                              '¿Quieres elegirla o cambiar los materiales del plan? ')
        else:
            model_question = ('Antes de elegir un modelo debo comprobar cuáles admiten estas '
                              'referencias en tu proyecto. ')
    return (f"He guardado un borrador para {recipe['label'].lower()}. {audience}{offer}"
            f"{source[data.get('sourceMode','undecided')]}{model_label}: {recipe['model']} "
            f"({recipe['verification']}). Recursos: {needs}.{reference_summary} {montage}"
            + (f"Falta confirmar: {', '.join(missing)}. " if missing else '')
            + ('' if plan['productBound'] or not data.get('offer') else
               'Aún no he vinculado este borrador a una ficha concreta. ')
            + (model_question if model_question_visible else '')
            + 'No he generado imágenes ni vídeo. El límite para generar medios con este plan es 0 USD; '
            'la conversación sí usa el modelo de texto de Google. Cualquier generación de medios '
            'necesitará presupuesto y autorización específicos.')

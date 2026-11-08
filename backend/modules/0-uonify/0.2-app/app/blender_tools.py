"""Uony solo puede consultar la escena autorizada o pedir una vista previa acotada."""
import json
import re
import unicodedata
from time import perf_counter
from uuid import uuid5
from fastapi import HTTPException
from .product_tools import ProductTools,DECLARATIONS as PRODUCT_DECLARATIONS
from .connection_tools import ConnectionActions, DECLARATIONS as CONNECTION_DECLARATIONS
from .conversation_forms import ConversationForms, DECLARATIONS as FORM_DECLARATIONS
from .creative_planning import CreativeTools, DECLARATIONS as CREATIVE_DECLARATIONS
from .creative_preparation_tools import CreativePreparationTools, DECLARATIONS as PREPARATION_DECLARATIONS
from .products import find, fail
from .product_guide import DECLARATION as GUIDE_DECLARATION
from .incident_guide import IncidentTools, DECLARATIONS as INCIDENT_DECLARATIONS
from .product_materials_guide import MaterialTools, DECLARATIONS as MATERIAL_DECLARATIONS
from .product_intake import IntakeTools, DECLARATION as INTAKE_DECLARATION
from .product_memory import ProductLinkTools, LINK_DECLARATION
from .uony_assignment_tool import AssignmentTools, DECLARATION as ASSIGNMENT_DECLARATION
from .drive_read_tools import DriveReadTools, DRIVE_READ_DECLARATIONS, DRIVE_READ_NAMES
from .blender_metrics import record
from . import blender_store as store

DECLARATIONS=[
 {'name':'get_blender_status','description':'Consulta el estado real del Blender local vinculado y su último trabajo. Una escena guardada puede ser anterior; mira status y lastSeenAt.','parameters':{'type':'OBJECT','properties':{}}},
 {'name':'inspect_blender_scene','description':'Solicita leer la escena actual de Blender local cuando el usuario lo pide. Devuelve un trabajo en cola; no afirmes que ha terminado. No modifica ni guarda archivos.','parameters':{'type':'OBJECT','properties':{}}},
 {'name':'render_blender_preview','description':'Solicita una vista previa pequeña de la escena local cuando el usuario pide verla. Solo encola; no confirma resultado ni genera un modelo nuevo. No modifica ni guarda el archivo de trabajo.','parameters':{'type':'OBJECT','properties':{}}},
]


def form_requested(user_text):
    """Only this customer's current request can opt into a model-made form."""
    if not isinstance(user_text, str) or not user_text.strip():
        return False
    text = re.sub(r'```.*?```|«[^»]*»|"[^"]*"|`[^`]*`', ' ', user_text, flags=re.S)
    text = ''.join(char for char in unicodedata.normalize('NFKD', text.casefold())
                   if not unicodedata.combining(char))
    if 'formulario' not in text:
        return False
    for clause in re.split(r'[.!?;\n]|\bpero\b', text):
        if not re.search(r'\bformulario\b', clause):
            continue
        if re.search(r'\b(?:no|nunca|sin)\b.{0,65}\bformulario\b', clause):
            continue
        if re.search(r'\b(?:quiero|prefiero|necesito)\b(?!\s+(?:saber|preguntar|consultar|que me digas))[^.!?]{0,65}\bformulario\b', clause):
            return True
        if re.search(r'\b(?:hazme|preparame|crea|muestrame|muestra|abre|ponme|pon|usa|utiliza|rellenar|rellena)\b.{0,65}\bformulario\b', clause):
            return True
        if re.search(r'\b(?:puedes|podrias)\b.{0,25}\b(?:abrir|mostrar|preparar|crear|poner|usar|hacer|rellenar)\b.{0,65}\bformulario\b', clause):
            return True
    return False


class BusinessTools(ProductTools):
    declarations=PRODUCT_DECLARATIONS+DECLARATIONS+CONNECTION_DECLARATIONS+FORM_DECLARATIONS+CREATIVE_DECLARATIONS+PREPARATION_DECLARATIONS+[GUIDE_DECLARATION,INTAKE_DECLARATION,LINK_DECLARATION,ASSIGNMENT_DECLARATION]+INCIDENT_DECLARATIONS+MATERIAL_DECLARATIONS+DRIVE_READ_DECLARATIONS

    def __init__(self,status,database,user,active,request_id,incidents=None,materials=None,thread_id=None,user_text=''):
        super().__init__(status,database,user,active)
        self.request_id=request_id
        # Lote 6 (A6, owner: «Por su cuenta, cuando ayude»): in writing the model offers
        # a form on its own when it saves the customer work; the output guard
        # (uony_form_guard) still forbids promising one it does not show. A spoken
        # job keeps the transcript's explicit opt-in until F1 (spoken_forms).
        self.form_requested=True
        self.declarations=[*type(self).declarations]
        self.guide_sku=None
        self.guide_mode_choice=False
        self.intake=IntakeTools(database,user,thread_id,request_id)
        self.assignment=AssignmentTools(database,user,thread_id,request_id,user_text)
        self.assignment_action_conflict=False
        self.product_link=ProductLinkTools(database,user,thread_id,user_text)
        self.connection_actions=ConnectionActions(status)
        self.conversation_forms=ConversationForms(request_id)
        self.creative=CreativeTools(database,user,thread_id,request_id,active,status.get('projectId'))
        self.creative_preparation=CreativePreparationTools(database,user,thread_id)
        self.creative_preparation_requested=False
        self.incidents=IncidentTools(incidents,user['id'],request_id)
        self.materials=MaterialTools(materials,database,user)
        self.drive_read=DriveReadTools(materials)

    def spoken_forms(self,user_text):
        """A spoken job keeps the transcript's explicit form opt-in until F1."""
        self.form_requested=form_requested(user_text)
        if not self.form_requested:
            self.declarations=[item for item in self.declarations if item['name']!='ask_user']

    def will_show_product_guide(self):
        return bool(self.intake.prepared or self.product_link.prepared or self.materials.sku or self.incidents.result or self.guide_sku)

    @staticmethod
    def same_sku(left,right):
        return (isinstance(left,str) and isinstance(right,str) and
                left.strip().casefold()==right.strip().casefold())

    def call(self,name,args):
        if name in DRIVE_READ_NAMES:
            return self.drive_read.call(name,args)
        if name=='get_creative_preparation':
            if args != {}:
                return {'error':'invalid_tool','message':'Esta consulta no recibe argumentos.'}
            self.creative_preparation_requested=True
            if self.creative.prepared:
                # The new plan is still in memory. Reading latest() here would
                # describe the previous plan. finish() reads after its commit.
                return {'status':'pending_plan_commit',
                    'message':'El estado del nuevo plan se consultará al guardarlo. No reutilices el plan anterior ni afirmes que ya está listo.'}
            return self.creative_preparation.call(name,args)
        if name in ('prepare_creative_plan','get_creative_plan'):
            if name == 'prepare_creative_plan' and (self.pending or self.intake.prepared or
                    self.product_link.prepared or self.assignment.prepared or
                    self.conversation_forms.present() or self.materials.sku or self.incidents.result):
                return {'error':'one_change','message':'Presenta primero la acción ya preparada.'}
            return self.creative.call(name,args)
        if self.creative.prepared and name not in ('get_connection_status','get_product',
                                                   'get_product_materials','list_products'):
            return {'error':'plan_pending','message':'Presenta primero el plan creativo preparado.'}
        if self.assignment.rejected:
            return {'error':'invalid_intent',
                    'message':'Antes de guardar un encargo nuevo, aclara si quieres iniciarlo ahora.'}
        if name=='remember_assignment':
            if (self.pending or self.intake.prepared or self.product_link.prepared or self.guide_sku or
                    self.materials.sku or self.conversation_forms.present() or self.incidents.result or
                    self.connection_actions.present()):
                self.assignment_action_conflict=True
                return {'error':'operation_pending','message':'Presenta primero la acción anterior. No guardes dos objetivos en un mensaje.'}
            return self.assignment.prepare(args)
        if self.assignment.prepared:
            return {'error':'assignment_pending',
                    'message':'Presenta primero el encargo guardado. Las herramientas y materiales se preparan en otro turno.'}
        if name=='link_product_to_thread':
            if (self.pending or self.intake.prepared or self.materials.sku or self.guide_sku or
                    self.conversation_forms.present() or self.incidents.result):
                return {'error':'operation_pending','message':'Termina primero la selección o el cambio anterior.'}
            return self.product_link.prepare(args,self.reads,self.search)
        if self.product_link.prepared and name in ('show_product_intake','create_product','update_product','start_product_guide',
                'show_product_materials','ask_user',*[item['name'] for item in INCIDENT_DECLARATIONS]):
            return {'error':'link_pending','message':'Vincularemos esta ficha antes de preparar otro cambio.'}
        if name=='show_product_intake':
            linked=self.get('productMemory')
            if linked:
                sku=linked['product']['sku']
                return {'error':'product_already_identified',
                    'message':f'Este hilo ya está vinculado a {sku}. Consulta get_product_materials y usa show_product_materials para sus archivos; pide elegir otra ficha si esa no es la correcta.'}
            if self.pending or self.guide_sku or self.materials.sku or self.conversation_forms.present() or self.incidents.result:
                return {'error':'product_already_identified','message':'Ya hay una ficha identificada. Usa sus materiales o continúa esa ficha; no abras otra preparación.'}
            return self.intake.prepare(args)
        if self.intake.prepared and name in ('create_product','update_product','start_product_guide','show_product_materials','ask_user',
                                             *[item['name'] for item in INCIDENT_DECLARATIONS]):
            return {'error':'intake_pending','message':'Presenta primero la selección de materiales preparada; todavía no crees otra ficha ni pidas su nombre.'}
        if (self.incidents.result or self.conversation_forms.present()) and name in (
                'create_product','update_product','start_product_guide','show_product_materials'):
            return {'error':'one_change','message':'Ya hay otra acción preparada en esta conversación. Preséntala antes de preparar una ficha distinta.'}
        if name=='ask_user' and (self.pending or self.guide_sku or self.materials.sku or self.incidents.result):
            return {'error':'one_change','message':'Ya hay una acción preparada en este mensaje. Preséntala antes de abrir otro formulario.'}
        if name=='show_product_materials' and (self.pending or self.guide_sku):
            return {'error':'one_change','message':'Ya hay una ficha o guía preparada en este mensaje. Continúa esa acción antes de abrir la tarjeta de materiales.'}
        if self.materials.sku and name in ('create_product','update_product','start_product_guide'):
            return {'error':'one_change','message':'La tarjeta de materiales ya está preparada en este mensaje. Continúa antes de modificar o guiar una ficha.'}
        if name=='show_product_materials' and self.materials.sku:
            if not isinstance(args,dict) or set(args)!={'sku'} or not self.same_sku(self.materials.sku,args['sku']):
                return {'error':'one_change','message':'La tarjeta de materiales ya está preparada para otra ficha en este mensaje.'}
            # A repeated call keeps the originally selected target.
            args={'sku':self.materials.sku}
        if self.guide_sku and name in ('create_product','update_product') and isinstance(args,dict) and \
                isinstance(args.get('sku'),str) and not self.same_sku(self.guide_sku,args['sku']):
            return {'error':'one_change','message':'Ya hay una guía preparada para otra ficha en este mensaje.'}
        if name in {item['name'] for item in MATERIAL_DECLARATIONS}:return self.materials.call(name,args,self.pending)
        if name in {item['name'] for item in INCIDENT_DECLARATIONS}:
            if (self.pending or self.guide_sku or self.materials.sku or
                    self.conversation_forms.present() or self.incidents.result):
                return {'error':'one_change','message':'Ya hay otra tarjeta preparada en este mensaje. Preséntala antes de abrir una incidencia.'}
            return self.incidents.call(name,args)
        if name=='start_product_guide':
            try:
                if not isinstance(args,dict) or set(args)-{'sku','offerModeChoice'} or not isinstance(args.get('sku'),str) or ('offerModeChoice' in args and type(args['offerModeChoice']) is not bool):
                    fail('invalid_tool','Indica el SKU del borrador que quieres completar.')
                requested=args['sku'].strip()
                pending_sku=(self.pending['sku'] or self.pending['data']['sku']) if self.pending else None
                if pending_sku and not self.same_sku(pending_sku,requested):
                    fail('one_change','Ya hay un cambio preparado para otra ficha en este mensaje.',409)
                # Una respuesta puede contener varias llamadas secuenciales. La
                # primera elección de guía queda fijada hasta la confirmación;
                # repetirla es inocuo, cambiar de ficha o modo no lo es.
                if self.guide_sku and (not self.same_sku(self.guide_sku,requested) or
                                       self.guide_mode_choice!=args.get('offerModeChoice',False)):
                    fail('one_change','Ya hay una guía preparada en este mensaje. Continúa esa ficha antes de elegir otra.',409)
                if self.pending and self.pending['sku'] is None:
                    target=pending_sku
                else:
                    with self.database.connect() as c:
                        target=find(c,self.user,requested)['sku']
                self.guide_sku=target
                self.guide_mode_choice=args.get('offerModeChoice',False)
                return {'prepared':True,'message':'La guía continuará en esta conversación usando la ficha y sus requisitos. La elección de módulo solo se presenta cuando el cliente la pide expresamente. No necesitas llamar a ask_user ni redactar las preguntas.'}
            except HTTPException as error:return error.detail
        if name=='show_amazon_connection':return self.connection_actions.show_amazon(args)
        if name=='show_account_deletion':return self.connection_actions.show_account_deletion(args)
        if name=='show_connection':return self.connection_actions.show(args)
        if name=='ask_user':
            if not self.form_requested:
                return {'error':'form_not_requested',
                        'message':'Haz una pregunta breve en texto y espera la respuesta en el chat.'}
            return self.conversation_forms.ask(args)
        if name not in {d['name'] for d in DECLARATIONS}:return super().call(name,args)
        started=perf_counter()
        try:
            if args!={}:raise HTTPException(400,detail={'error':'invalid_tool','message':'Esta herramienta no admite argumentos.'})
            with self.database.connect() as c:
                user=c.execute('SELECT * FROM users WHERE id=%s FOR UPDATE',(self.user['id'],)).fetchone()
                product_id=find(c,user,self.active['sku'])['id'] if self.active else None
                if name=='get_blender_status':result=store.status(c,user,product_id=product_id)
                else:
                    operation='inspect_scene' if name=='inspect_blender_scene' else 'render_preview'
                    job=store.enqueue(c,user,uuid5(self.request_id,name),operation,'uony',product_id=product_id)
                    result={'job':job,'message':'Consulta get_blender_status para conocer el resultado confirmado.'}
        except HTTPException as error:result=error.detail
        record(self.database,self.user['id'],'uony_tool:'+name,len(json.dumps(args).encode()),
               len(json.dumps(result,default=str).encode()),round((perf_counter()-started)*1000))
        return result

"""Definición de las ocho etapas: datos de producto y preparación de trabajos pendientes."""
from copy import deepcopy
import json

ORDER = ('atributos', 'auditoria', 'descripciones', 'gpsr', 'imagenes', 'modelos3d', 'video', 'aplus')
MODE_CHOICES = {'Formulario interactivo': 'guided', 'Módulo Producto': 'manual'}


def field(id, label, type='text', required=False, options=None):
    return {'id': id, 'label': label, 'type': type, 'required': required, **({'options': options} if options else {})}


SECTIONS = [
    {'id': 'atributos', 'label': 'Atributos', 'kind': 'product-fields',
     'notice': 'Guardaremos estos datos en la ficha. Los requisitos específicos de Amazon se comprobarán con el tipo de producto.',
     'fields': [field('name', 'Nombre del producto', required=True), field('brand', 'Marca'), field('category', 'Tipo de producto'),
                field('price', 'Precio previsto'), field('cost', 'Coste'), field('stock', 'Unidades disponibles'),
                field('material', 'Materiales confirmados'), field('dimensions', 'Dimensiones y unidades')]},
    {'id': 'auditoria', 'label': 'Auditoría IA', 'kind': 'planning',
     'notice': 'Guardamos el alcance de la revisión. Todavía no se ha ejecutado una auditoría ni una investigación de competidores.',
     'fields': [field('customer', '¿Para quién es el producto?', 'textarea'), field('benefits', 'Ventajas comprobables', 'textarea'),
                field('differences', '¿Qué lo diferencia?', 'textarea'), field('checks', 'Aspectos que debemos comprobar', 'textarea')]},
    {'id': 'descripciones', 'label': 'Descripciones', 'kind': 'product-fields',
     'notice': 'Descripción, viñetas y palabras clave se guardan en el mismo borrador de Producto. Puedes completarlas o pedir a Uony que las redacte después.',
     'fields': [field('description', 'Descripción del producto', 'textarea'), field('bullets', 'Viñetas: una por línea, hasta seis', 'textarea'),
                field('keywords', 'Palabras clave'), field('tone', 'Tono de la marca')]},
    {'id': 'gpsr', 'label': 'GPSR', 'kind': 'planning',
     'notice': 'Recopilamos la información de seguridad declarada. Guardarla no certifica cumplimiento legal ni sustituye la revisión de documentos.',
     'fields': [field('manufacturer', 'Fabricante'), field('manufacturer_contact', 'Contacto del fabricante'),
                field('responsible_operator', 'Operador responsable, si corresponde'), field('warnings', 'Advertencias e instrucciones de uso', 'textarea'),
                field('documents', 'Documentos de seguridad disponibles o pendientes', 'textarea')]},
    {'id': 'imagenes', 'label': 'Imágenes', 'kind': 'planning',
     'notice': 'Guardamos el plan de imágenes y los materiales declarados. La generación, lectura y comprobación automática de los archivos todavía están pendientes.',
     'fields': [field('source', 'Materiales de partida', 'select', options=['Ya tengo imágenes', 'Necesito crearlas', 'Lo decidiré más adelante']),
                field('main_image', 'Cómo debe mostrarse la imagen principal', 'textarea'), field('gallery', 'Vistas, detalles y usos para la galería', 'textarea'),
                field('brand_style', 'Estilo e identidad de marca', 'textarea'), field('files', 'Dónde están los archivos o cuáles faltan', 'textarea')]},
    {'id': 'modelos3d', 'label': '3D', 'kind': 'local3d',
     'notice': 'Guardamos la preparación 3D. Blender local permite consultar una escena y pedir una vista previa; guardar este plan no crea ni modifica un modelo.',
     'fields': [field('existing_model', 'Modelo o escena disponible', 'textarea'), field('desired_result', 'Qué quieres mostrar en 3D', 'textarea'),
                field('views', 'Vistas necesarias', 'textarea'), field('measurements', 'Medidas y referencias confirmadas', 'textarea')]},
    {'id': 'video', 'label': 'Vídeo', 'kind': 'planning',
     'notice': 'Guardamos el encargo del vídeo. El guion, los recursos y el vídeo final necesitan creación y revisión; la generación de vídeo aún no está integrada.',
     'fields': [field('goal', 'Objetivo del vídeo', 'textarea'), field('story', 'Historia o demostración que debe contar', 'textarea'),
                field('duration', 'Duración y formato previstos'), field('assets', 'Recursos disponibles', 'textarea'), field('brand_style', 'Indicaciones de marca', 'textarea')]},
    {'id': 'aplus', 'label': 'A+', 'kind': 'planning',
     'notice': 'Guardamos el planteamiento de A+. La elegibilidad de la marca, los módulos finales y la publicación en Amazon siguen pendientes de comprobación.',
     'fields': [field('brand_story', 'Historia de la marca', 'textarea'), field('benefits', 'Beneficios que deben destacarse', 'textarea'),
                field('modules', 'Secciones o comparaciones deseadas', 'textarea'), field('assets', 'Imágenes y recursos disponibles', 'textarea'),
                field('eligibility', 'Situación de la marca en Amazon', 'select', options=['Registrada en Amazon Brand Registry', 'No está registrada', 'Pendiente de comprobar'])]},
]
BY_ID = {section['id']: section for section in SECTIONS}
PRODUCT_FIELDS = {'atributos': ('name', 'brand', 'category', 'price', 'cost', 'stock'), 'descripciones': ('description', 'bullets', 'keywords')}
CUSTOM_FIELDS = {'material': 'Materiales', 'dimensions': 'Dimensiones'}


def empty_state():
    return {'mode': None, 'activeSection': ORDER[0], 'sections': {}}


def validate_state(value):
    if not isinstance(value, dict) or set(value) != {'mode', 'activeSection', 'sections'}:
        raise ValueError('Preparación no válida.')
    if value['mode'] not in (None, 'guided', 'manual') or value['activeSection'] not in ORDER or not isinstance(value['sections'], dict):
        raise ValueError('Preparación no válida.')
    if set(value['sections']) - set(ORDER):
        raise ValueError('Sección no válida.')
    if len(json.dumps(value, ensure_ascii=False).encode('utf-8')) > 512000:
        raise ValueError('La preparación supera el tamaño permitido.')
    for key, section in value['sections'].items():
        if not isinstance(section, dict) or set(section) != {'answers', 'reviewed'} or type(section['reviewed']) is not bool:
            raise ValueError('Sección no válida.')
        validate_answers(key, section['answers'])
    return deepcopy(value)


def validate_answers(section, answers, complete=False):
    if section not in ORDER or not isinstance(answers, dict):
        raise ValueError('Respuestas no válidas.')
    definitions = {f['id']: f for f in BY_ID[section]['fields']}
    definitions.update({f['id'] + '_notes': field(f['id'] + '_notes', 'Notas', 'textarea') for f in BY_ID[section]['fields']})
    if set(answers) - set(definitions):
        raise ValueError('Hay campos que no pertenecen a esta sección.')
    for key, value in answers.items():
        if not isinstance(value, str) or len(value.encode('utf-16-le')) // 2 > 3000 or '\x00' in value:
            raise ValueError('Cada respuesta admite hasta 3000 caracteres de texto.')
    if complete and any(f['required'] and not answers.get(f['id'], '').strip() for f in definitions.values()):
        raise ValueError('Completa los campos obligatorios antes de continuar.')
    return deepcopy(answers)

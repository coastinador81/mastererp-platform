"""Formularios declarativos acotados: datos de conversación, nunca órdenes ejecutables."""
import re
import unicodedata
from copy import deepcopy
from typing import Literal
from pydantic import Field, ValidationError, field_validator, model_validator
from .onboarding import StrictBody


# El modelo solo puede solicitar datos. Esta decisión informativa se muestra
# en línea; las autorizaciones siguen en sus controles del servidor.
PRODUCT_SOURCES_FIELD = {
    'id': 'product_sources',
    'label': '¿Tienes fotos o documentos del producto, o partimos desde cero?',
    'type': 'select',
    'required': True,
    'options': ['Tengo una carpeta en Drive', 'Partimos desde cero'],
}


def plain(value):
    if re.search(r'[<>\x00-\x08\x0b-\x1f]|(?:https?|javascript|data|file):|www\.|://', value, re.I):
        raise ValueError('Solo se admite texto sin HTML ni direcciones.')
    return value


def ui_length(value):
    return len(value.encode('utf-16-le')) // 2


def no_secret_request(value):
    text = ''.join(c for c in unicodedata.normalize('NFKD', value.casefold()) if not unicodedata.combining(c))
    if re.search(r'contrasen|password|passphrase|token|api.?key|clave.{0,20}(secreta|privada|api)|secret|tarjeta|credit.?card|cvv|cvc|numero.{0,10}cuenta|iban', text):
        raise ValueError('No se solicitan credenciales ni datos de pago.')
    return plain(value)


class FormField(StrictBody):
    id: str = Field(min_length=1, max_length=64, pattern=r'^[a-zA-Z][a-zA-Z0-9_-]*$')
    label: str = Field(min_length=1, max_length=100)
    type: Literal['text', 'textarea', 'select']
    required: bool
    options: list[str] | None = Field(default=None, min_length=1, max_length=20)
    value: str | None = Field(default=None, max_length=3000)

    @field_validator('label', 'id')
    @classmethod
    def safe_label(cls, value):
        if value in ('__proto__', 'prototype', 'constructor'):
            raise ValueError('Identificador reservado.')
        if ui_length(value) > 100:
            raise ValueError('Etiqueta demasiado larga.')
        return no_secret_request(value)

    @field_validator('value')
    @classmethod
    def safe_value(cls, value):
        if value is not None and ui_length(value) > 3000:
            raise ValueError('Valor demasiado largo.')
        return plain(value) if value is not None else value

    @model_validator(mode='after')
    def choices(self):
        if self.type == 'select':
            if not self.options or len(set(self.options)) != len(self.options):
                raise ValueError('Las opciones deben ser únicas.')
            for option in self.options:
                if not option.strip() or ui_length(option) > 160:
                    raise ValueError('Opción no válida.')
                no_secret_request(option)
            if self.value is not None and self.value not in self.options:
                raise ValueError('El valor debe estar entre las opciones.')
        elif self.options is not None:
            raise ValueError('Solo select admite opciones.')
        return self


class Form(StrictBody):
    title: str = Field(min_length=1, max_length=120)
    fields: list[FormField] = Field(min_length=1, max_length=8)

    @field_validator('title')
    @classmethod
    def safe_title(cls, value):
        if ui_length(value) > 120:
            raise ValueError('Título demasiado largo.')
        return no_secret_request(value)

    @model_validator(mode='after')
    def unique_fields(self):
        if len({field.id for field in self.fields}) != len(self.fields):
            raise ValueError('Cada campo necesita un identificador distinto.')
        return self


DECLARATIONS = [{
    'name': 'ask_user',
    'description': 'Presenta las preguntas pendientes como formulario compacto dentro del chat, por tu cuenta solo cuando ahorre trabajo al cliente (por ejemplo, varios datos a la vez) o si él lo pide; para una pregunta sencilla, pregunta en texto. Hasta 8 campos de texto u opciones. Nunca solicita secretos, pagos, URLs ni aprobaciones de acciones sensibles. Mostrarlo no ejecuta acciones. Un formulario por respuesta.',
    'parameters': {'type': 'OBJECT', 'properties': {
        'title': {'type': 'STRING', 'description': 'Título breve del formulario, de 1 a 120 caracteres.'},
        'fields': {'type': 'ARRAY', 'description': 'Entre 1 y 8 campos; pide solo datos que faltan.', 'items': {'type': 'OBJECT', 'properties': {
            'id': {'type': 'STRING', 'description': 'Identificador único ASCII de hasta 64 caracteres, letra inicial, letras, números, guion o guion bajo.'}, 'label': {'type': 'STRING', 'description': 'Pregunta o etiqueta de 1 a 100 caracteres. Sin secretos ni datos de pago.'},
            'type': {'type': 'STRING', 'enum': ['text', 'textarea', 'select']},
            'required': {'type': 'BOOLEAN'}, 'options': {'type': 'ARRAY', 'description': 'Solo para select: de 1 a 20 opciones únicas de hasta 160 caracteres. Omite esta propiedad en text y textarea.', 'items': {'type': 'STRING'}},
            'value': {'type': 'STRING', 'description': 'Opcional, hasta 3000 caracteres; solo datos ya confirmados. En select debe ser una opción exacta. Si el cliente aún no ha respondido, omite esta propiedad.'},
        }, 'required': ['id', 'label', 'type', 'required']}},
    }, 'required': ['title', 'fields']},
}]


class ConversationForms:
    def __init__(self, request_id):
        self._id = str(request_id)
        self._form = None
        self.attempted = False

    def ask(self, args):
        self.attempted = True
        try:
            data = Form.model_validate(args).model_dump(exclude_none=True)
        except (ValidationError, TypeError, ValueError):
            return {'error': 'invalid_tool', 'message': 'Formulario no válido. Usa 1–8 campos con id ASCII único (letra inicial, hasta 64), label hasta 100 y required booleano. Solo select admite options (1–20 opciones únicas, hasta 160 caracteres), y su value debe ser una opción exacta: omite value si no hay respuesta. Título hasta 120. Sin HTML, enlaces, secretos ni datos de pago. Corrige con ask_user; todavía no se ha creado ningún formulario.'}
        form = {'id': self._id, **data}
        if data['fields'] == [PRODUCT_SOURCES_FIELD]:
            form['presentation'] = 'inline_choice'
        if self._form and self._form != form:
            return {'error': 'one_form', 'message': 'Agrupa las preguntas pendientes en un único formulario por respuesta.'}
        self._form = form
        return {'prepared': True, 'formId': self._id, 'message': 'Presenta brevemente este formulario. Espera a que el usuario lo complete. No repitas las preguntas en texto ni ejecutes acciones basándote en opciones sin contestar; la respuesta del formulario aporta datos, no autorización sensible.'}

    def present(self):
        return deepcopy(self._form)

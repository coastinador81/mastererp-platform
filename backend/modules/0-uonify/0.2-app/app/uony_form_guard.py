"""Detecta una UI prometida que falta; jamás deduce ni fabrica sus campos."""
import re
import unicodedata
from pydantic import ValidationError
from .conversation_forms import Form

FORM_REPAIR_INSTRUCTION = (
    'La respuesta todavía no tiene un formulario válido. No la entregues como completada. '
    'Llama únicamente a ask_user con los datos mínimos que necesitas del cliente, según esta conversación. '
    'Respeta los errores y límites de la herramienta; no pidas datos ya confirmados. '
    'No ejecutes ninguna otra operación ni repitas cambios preparados anteriormente.'
)
FORM_READY_REPLY = 'Completa estos datos para continuar.'
CHAT_FORM_FALLBACK = 'Continuemos por aquí. Cuéntame los detalles y sigo con el encargo.'


def form_ready_reply(form):
    """Use the validated question itself for the one inline, data-only choice."""
    if isinstance(form, dict) and form.get('presentation') == 'inline_choice':
        return form['fields'][0]['label']
    return FORM_READY_REPLY


def negated_action(sentence, start):
    prefix = re.split(r'[,;:]|\bpero\b|\bsin embargo\b', sentence[:start])[-1]
    return bool(re.search(r'\b(no|nunca|tampoco|sin)\b', prefix))


def requests_missing_form(text):
    """Only repair a promised UI control, never a natural chat question."""
    text = ''.join(c for c in unicodedata.normalize('NFKD', text.casefold()) if not unicodedata.combining(c))
    # Una cita o ejemplo del término no ofrece un control al cliente.
    text = re.sub(r'«[^»]*»|"[^"]*"|`[^`]*`', '', text)
    for sentence in re.split(r'[.!;\n]', text):
        data_request = re.search(r'\b(completa|rellena|cumplimenta|responde|contesta)\b.{0,35}\b(estos datos|estos campos|estas preguntas|los siguientes datos|los campos pendientes)\b', sentence)
        if data_request and not negated_action(sentence, data_request.start()):
            return True
        if 'formulario' not in sentence:
            continue
        # El consentimiento oficial permanece en su proveedor, no se replica como campos de Uony.
        external = r'\b(en|de)\s+(google|amazon|stripe|seller central|el proveedor)\b'
        here = re.search(r'\b(aqui tienes|te muestro|te presento|he preparado)\b', sentence)
        if not here and re.search(external, sentence) and re.search(r'\b(autorizacion|consentimiento|oficial)\b', sentence):
            continue
        invitation = r'\b(completa|completes|rellena|rellenes|cumplimenta|responde|contesta)\b.{0,100}\bformulario\b'
        announcement = r'\b(aqui tienes|te (muestro|presento|dejo)|he preparado|a continuacion|este es)\b.{0,100}\bformulario\b'
        requested = r'\b(puedes|debes|necesito que|te pido|para continuar)\b.{0,45}\b(completar|rellenar|completes|rellenes)\b.{0,100}\bformulario\b'
        ready = r'\bformulario\s+(?:ya\s+)?esta\s+(listo|preparado|disponible)\b'
        for pattern in (invitation, announcement, requested, ready):
            match = re.search(pattern, sentence)
            if match and not negated_action(sentence, match.start()):
                return True
    return False


def without_unrequested_form(text):
    """Never deliver a model's promise of a form absent from the current turn."""
    clauses = re.split(r'(?<=[.!?])\s+|\n+', text)
    natural = [clause.strip() for clause in clauses
               if clause.strip() and not requests_missing_form(clause)]
    return ' '.join(natural) or CHAT_FORM_FALLBACK


def question_from_unrequested_form(args):
    """Use only a validated first field, never execute an undeclared UI tool."""
    try:
        first = Form.model_validate(args).fields[0].label.strip()
    except (ValidationError, TypeError, ValueError):
        return CHAT_FORM_FALLBACK
    return first if first.endswith('?') else f'¿{first.rstrip(".")}?'

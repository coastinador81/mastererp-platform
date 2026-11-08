"""Verified voice capability facts for Uony's text conversation."""
import re
import unicodedata

from .google_cloud_provider import SCOPE
from .uony_live_bridge import pilot_budget_available


def voice_status(connection, user, cloud, settings, service_status):
    """Use the same account, Cloud scope and durable pilot budget as Live admission."""
    if (str(user['id']) not in settings.live_pilot_user_ids
            or not user.get('onboarding_completed_at')
            or not service_status.get('projectReady')
            or SCOPE not in (cloud['scope'] or '').split()):
        return 'not_integrated'
    return ('pilot_ready' if pilot_budget_available(
        connection, user['id'], settings.live_pilot_session_limit)
        else 'pilot_exhausted')


VOICE_FACT = {
    'not_integrated': ('Gemini Live no está habilitado para esta cuenta. '
                       'El botón de voz puede usar funciones del navegador; no lo presentes como Live.'),
    'pilot_ready': ('Gemini Live está disponible como piloto en el botón de voz de esta cuenta. '
                    'Esta respuesta de chat es texto: no afirmes que ya existe una sesión Live activa.'),
    'pilot_exhausted': ('El cupo de sesiones piloto de Gemini Live de esta cuenta se agotó. '
                        'No prometas abrir otra sesión Live.'),
}


def _plain(value):
    folded = unicodedata.normalize('NFKD', value.casefold())
    return ''.join(character for character in folded if not unicodedata.combining(character))


_LIVE = re.compile(r'\b(?:gemini\s+live|live\s+api|live|voz\s+de\s+google|'
                   r'(?:voz|audio|conversacion)\s+en\s+tiempo\s+real)\b')
_POSITIVE = re.compile(r'\b(?:activ[oa]s?|activad[oa]s?|integrad[oa]s?|disponibles?|'
                       r'funcionando|operativ[oa]s?|conectad[oa]s?|habilitad[oa]s?|'
                       r'instalad[oa]s?|configurad[oa]s?|encendid[oa]s?|esta\s+list[oa]|'
                       r'ya\s+funciona|ya\s+puedo|'
                       r'te\s+hablo|te\s+escucho|te\s+respondo|'
                       r'(?:estoy|estamos)\s+(?:usando|utilizando|hablando)|'
                       r'usamos|utilizamos|hemos\s+activado|'
                       r'puedes\s+usarlo|puedes\s+hablar|puedo\s+usarlo)\b')
_DENIAL = re.compile(r'\b(?:no|nunca|sin|aun\s+no|todavia\s+no|pendiente|'
                     r'cuando\s+se|si\s+se|podria|permitiria)\b')
_CURRENT = re.compile(r'\b(?:ahora\s+mismo|en\s+este\s+momento|esta\s+respuesta|'
                      r'esta\s+conversacion|te\s+estoy\s+hablando|te\s+hablo|'
                      r'yo\s+uso|(?:estoy|estamos)\s+(?:usando|utilizando|hablando))\b')


def mentions_voice_feature(text):
    return isinstance(text, str) and bool(_LIVE.search(_plain(text)))


def accurate_voice_reply(reply, status):
    """Replace an unsupported Live claim rather than persisting it as fact.

    This is a narrow final guard; the verified fact in the model instruction is
    the primary path. A replacement never starts a model call or voice session.
    """
    if not isinstance(reply, str):
        return reply
    for clause in re.split(r'[.!?;:,\n]+', _plain(reply)):
        if not _LIVE.search(clause) or not _POSITIVE.search(clause):
            continue
        if _DENIAL.search(clause):
            continue
        if status == 'pilot_ready' and not _CURRENT.search(clause):
            continue
        if status == 'pilot_exhausted':
            return ('El piloto de Gemini Live de tu cuenta ya agotó su sesión autorizada. '
                    'Podemos seguir conversando por texto.')
        if status == 'pilot_ready':
            return ('Gemini Live está disponible en el botón de voz, pero esta respuesta '
                    'te llega por texto; no hay una sesión de voz activa aquí.')
        return ('Gemini Live no está habilitado para tu cuenta ahora mismo. '
                'Puedes seguir conversando por texto.')
    return reply

"""Explicit refusals in the customer's own words: a veto, never consent.

Spoken admissions only, until F1: the spoken handoff and the typed Drive call
(audit F0.2, «Consultor google» 20-10-2026). In writing the model understands
a «no» (owner's decision 5 and «Consultor google», 21-10-2026), since a word
list cannot: «No quiero que lo leas mal, léelo» is an order to read. It can
only block an action, and the server then says a fixed text. It never
authorizes, classifies or chooses an operation (never list against read):
using it to decide one is a BLOQUEADO.
"""
import re
import unicodedata

REFUSAL = re.compile(
    r'^(?:no\s+(?:(?:me|te|lo|la|los|las|le|les|nos|se)\s+)?(?:quiero|necesito|deseo|hagas|'
    r'crees|analices|uses|leas|abras|resumas|mires|revises|cuentes|busques|consultes|toques)\b'
    r'|detente\b)')
# A message that is only a negative answer, e.g. to the server's own question
# «¿Quieres que lea…?» (lote 3, «Consultor google» 21-10-2026): «No.», «No,
# gracias», «Mejor no», «Déjalo». «No, lee la carpeta» stays an order.
NEGATIVE_ANSWER = re.compile(
    r'^(?:(?:no|mejor no|ahora no|todav[ií]a no|a[uú]n no)(?:,? (?:gracias|d[eé]jalo|olv[ií]dalo))?'
    r'|d[eé]jalo|olv[ií]dalo)[.! ]*$')


def refused(text):
    """Whether the words open with a clear refusal, such as «No lo abras».

    Case and spacing are ignored; punctuation is not: «No, lee la carpeta» is
    an order, «No leas la carpeta» a refusal.
    """
    value = re.sub(r'\s+', ' ', unicodedata.normalize('NFKC', text).casefold()).strip()
    return bool(REFUSAL.match(value) or NEGATIVE_ANSWER.match(value))

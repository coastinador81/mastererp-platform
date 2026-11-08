"""Normalización de valores sin perder las expresiones ni sus reservas originales."""
import re
from decimal import Decimal, InvalidOperation
from .product_materials_fields import normalized_label

QUALIFIERS = re.compile(r'\(([^()]*)\)')
QUALIFIER_WORDS = ('confirmado por', 'declarado', 'diseno 3d', 'modelo 3d', 'nominal',
                   'no verificado', 'pendiente', 'provisional', 'borrador', 'verificado digital',
                   'gs1', 'segun guia', 'datos tecnicos', 'segun icono', 'observacion no certificada',
                   'observacion no verificada', 'observado en render', 'no verificada')
UNITS = {'mm': ('mm', Decimal(1)), 'cm': ('mm', Decimal(10)), 'm': ('mm', Decimal(1000)),
         'g': ('g', Decimal(1)), 'kg': ('g', Decimal(1000))}
COUNT_UNITS = {
    'custom:numero_piezas': ('unidades', r'piezas?|bloques?|unidades?'),
    'custom:niveles_torre': ('niveles', r'niveles?|levels?'),
    'custom:numero_personajes': ('personajes', r'personajes?|variantes?'),
    'custom:bloques_por_servicio': ('unidades', r'piezas?|bloques?|unidades?'),
    'custom:parejas_frases': ('parejas', r'parejas?'),
    'custom:alternancia_niveles': ('grados', r'grados?|degrees?|°'),
}
NUMBER_WORDS = dict(zip(('cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete',
                        'ocho', 'nueve', 'diez', 'once', 'doce'), range(13)))
LANGUAGES = {'es': 'ES', 'espanol': 'ES', 'en': 'EN', 'ingles': 'EN', 'fr': 'FR', 'frances': 'FR',
             'de': 'DE', 'aleman': 'DE', 'it': 'IT', 'italiano': 'IT', 'pt': 'PT', 'portugues': 'PT'}


def language_set(value):
    text = normalized_label(re.sub(r'\(solo packaging\)', '', value, flags=re.I))
    text = re.sub(r'^instrucciones y advertencias del packaging en ', '', text)
    tokens = [word for word in text.split() if word != 'y']
    return sorted({LANGUAGES[word] for word in tokens}) if tokens and all(word in LANGUAGES for word in tokens) else None


def stripped_value(value):
    def remove(match):
        return '' if any(word in normalized_label(match[1]) for word in QUALIFIER_WORDS) else match[0]
    return re.sub(r'\s+', ' ', QUALIFIERS.sub(remove, value)).strip().rstrip('.').strip()


def decimal_text(value):
    return format(value.normalize(), 'f')


def normalize_value(field, value):
    """Devuelve clave comparable, valor legible y unidad; no mezcla unidades de distinta magnitud."""
    clean = stripped_value(value)
    folded = normalized_label(clean)
    unit = None
    if field == 'custom:idiomas_del_envase' and (languages := language_set(clean)):
        return ' '.join(languages), ', '.join(languages), None
    if field == 'custom:ean_gtin_13':
        match = re.search(r'(?<!\d)(?:\d[ -]?){12}\d(?!\d)', clean)
        if match:
            normalized = re.sub(r'\D', '', match[0])
            return normalized, normalized, None
    if field == 'custom:edad_minima':
        match = re.search(r'(?<![\d.,])(\d+(?:[,.]\d+)?)\s*(años?|anos?|years?|mes(?:es)?|months?|\+)', clean.casefold())
        if match:
            months = Decimal(match[1].replace(',', '.')) * (1 if match[2].startswith(('mes', 'month')) else 12)
            return decimal_text(months), decimal_text(months) + ' meses', 'meses'
        match = re.fullmatch(r'(?:edad )?(\d+)\+', clean.casefold())
        if match:
            months = Decimal(match[1]) * 12
            return decimal_text(months), decimal_text(months) + ' meses', 'meses'
    if field in COUNT_UNITS:
        count_unit, suffix = COUNT_UNITS[field]
        count_text = re.sub(r'\s+en el modelo$', '', clean.casefold())
        count_text = re.sub(r'^(' + '|'.join(NUMBER_WORDS) + r')\b', lambda m: str(NUMBER_WORDS[m[1]]), count_text)
        match = re.fullmatch(r'(\d+)\s*(?:' + suffix + r')?', count_text)
        if match:
            number = str(int(match[1]))
            return number, number if field == 'custom:numero_piezas' else number + ' ' + count_unit, count_unit
    if field == 'custom:pais_fabricacion':
        countries = [re.sub(r'^(?:fabricado en|hecho en|made in)\s+', '', part.strip(), flags=re.I)
                     for part in clean.split('/')]
        # Quitar sólo el rótulo; no traducir países ni elegir entre orígenes distintos.
        if countries and all(normalized_label(part) == normalized_label(countries[0]) for part in countries):
            clean = countries[0]
    if field in ('custom:fabricante', 'custom:persona_responsable'):
        # El domicilio anexo no cambia la razón social, pero se conserva en originalValues.
        match = re.match(r'(.+?\b(?:LLC|LTD|INC|S\.?L\.?|S\.?A\.?))(?=\s*(?:[,(-]| - |\d)|$)', clean, re.I)
        if match:
            clean = match[1]
    if field == 'custom:material':
        if folded in {'wood', 'madera', 'madera natural'} or re.fullmatch(r'madera[,;] (?:especie|acabado|especie y acabado).*por confirmar', clean, re.I):
            return 'madera', 'Madera', None
    # Una expresión puramente dimensional admite conversión exacta. No convertir prosa o rangos.
    dimension = re.fullmatch(r'([\d.,]+(?:\s*[x×]\s*[\d.,]+){0,2})\s*(mm|cm|m|kg|g)', clean, re.I)
    if dimension:
        try:
            unit, factor = UNITS[dimension[2].lower()]
            numbers = [decimal_text(Decimal(n.strip().replace(',', '.')) * factor)
                       for n in re.split('[x×]', dimension[1])]
            normalized = ' × '.join(numbers)
            return normalized, normalized + ' ' + unit, unit
        except InvalidOperation:
            pass
    return normalized_label(clean), clean, unit


def valid_gtin(value):
    if not re.fullmatch(r'\d{13}', value):
        return False
    return (10 - sum(int(n) * (1 if i % 2 == 0 else 3) for i, n in enumerate(value[:12])) % 10) % 10 == int(value[-1])


def value_supported(field, value, excerpt, context=''):
    """Apoyo literal o conversión cerrada; nunca similitud semántica libre ni nombre de fichero."""
    key, display, unit = normalize_value(field, value)
    clean = stripped_value(value)
    normalized_excerpt = normalized_label(excerpt)
    # La negación de la fuente no puede transformarse en una afirmación positiva.
    negative = re.search(r'\b(?:no contiene|no es|no lleva|no incluye|no|sin|not made of|does not contain|not)\s+(?:\w+\s+){0,2}' + re.escape(key) + r'\b', normalized_excerpt)
    if negative and not re.search(r'\b(?:no|sin|not)\b', normalized_label(value)):
        return False
    # Evita que un correo, URL, ruta o palabra compuesta se tome como nombre/marca.
    if field in ('name', 'brand', 'custom:modelo', 'custom:fabricante', 'custom:persona_responsable'):
        needle = stripped_value(display)
        return bool(needle and re.search(r'(?<![\w@/.-])' + re.escape(needle) + r'(?![\w@/.-])', excerpt, re.I))
    if field == 'custom:ean_gtin_13':
        digits = re.findall(r'(?<!\d)(?:\d[ -]?){12}\d(?!\d)', excerpt)
        return any(re.sub(r'\D', '', match) == key for match in digits)
    if field == 'custom:edad_minima':
        # Se aceptan equivalencias de meses/años; un 3 de otro atributo no es una edad.
        candidates = re.findall(r'\d+(?:[,.]\d+)?\s*(?:años?|years?|mes(?:es)?|months?|\+)', excerpt, re.I)
        if any(normalize_value(field, candidate)[0] == key for candidate in candidates):
            return True
        number = re.fullmatch(r'["\s]*(\d+(?:[,.]\d+)?)["\s]*', excerpt)
        return bool(number and 'edad' in normalized_label(context) and
                    normalize_value(field, number[1] + (' meses' if 'meses' in context else ' años'))[0] == key)
    if field in COUNT_UNITS and unit:
        suffix = COUNT_UNITS[field][1]
        numeric_excerpt = re.sub(r'\b(' + '|'.join(NUMBER_WORDS) + r')\b',
                                 lambda m: str(NUMBER_WORDS[m[1].lower()]), excerpt, flags=re.I)
        numbers = re.findall(r'(?<![\d.,])(\d+)\s*(?:' + suffix + r')(?!\w)', numeric_excerpt, re.I)
        if key in [str(int(number)) for number in numbers]:
            return True
        # Un número desnudo sólo se relaciona con el atributo mediante su registro.
        if re.fullmatch(r'["\s]*' + re.escape(key) + r'["\s]*', excerpt):
            declared_units = re.findall(r'\.unit:\s*"([^"\n]+)"', context)
            if declared_units and not all(re.fullmatch(suffix, item.strip(), re.I) for item in declared_units):
                return False
            if field == 'custom:alternancia_niveles' and not declared_units and not re.search(r'\b(?:grados?|degrees?)\b', context, re.I):
                return False
            return bool(context) or field == 'custom:numero_piezas'
        return field == 'custom:numero_piezas' and bool(re.search(r'(?<!\d)' + re.escape(key) + r'(?!\d)', excerpt))
    if unit:
        candidates = re.findall(r'[\d.,]+(?:\s*[x×]\s*[\d.,]+){0,2}\s*(?:mm|cm|m|kg|g)\b', excerpt, re.I)
        if any(normalize_value(field, candidate)[0:3:2] == (key, unit) for candidate in candidates):
            return True
        # JSON almacena valor y unidad en hojas hermanas, recuperadas del original.
        if re.fullmatch(r'["\s\d.,x×]+', excerpt):
            declared_units = re.findall(r'\.unit:\s*"([^"\n]+)"', context)
            if declared_units:
                # The sibling unit belongs to this JSON record. Convert it, rather
                # than appending the canonical unit to a quantity in centimetres.
                distinct = {item.strip().lower() for item in declared_units}
                return len(distinct) == 1 and normalize_value(
                    field, excerpt.strip('" ') + ' ' + next(iter(distinct)))[0:3:2] == (key, unit)
            if re.search(r'\b' + re.escape(unit) + r'\b', context):
                return normalize_value(field, excerpt.strip('" ') + ' ' + unit)[0] == key
    if field == 'custom:material' and key == 'madera':
        return bool(re.search(r'\b(?:madera|wood)\b', normalized_excerpt))
    if field == 'custom:idiomas_del_envase' and language_set(value):
        return language_set(value) == language_set(excerpt.strip('" '))
    return bool(key and re.search(r'(?<!\w)' + re.escape(key) + r'(?!\w)', normalized_excerpt))

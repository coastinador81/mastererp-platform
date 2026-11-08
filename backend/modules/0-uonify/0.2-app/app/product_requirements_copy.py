"""Texto para clientes separado de las claves y las reglas internas de Amazon."""
import re
from collections import Counter
from decimal import Decimal
from .incident_fields import clean

LABELS = {
    'item_name': 'nombre del producto', 'name': 'nombre del producto', 'brand': 'marca',
    'age': 'edad recomendada', 'count': 'cantidad', 'height': 'altura', 'weight': 'peso',
    'material': 'material', 'battery': 'pilas', 'battery_count': 'número de pilas',
    'manufacturer': 'fabricante', 'country_of_origin': 'país de fabricación',
    'item_package_weight': 'peso del producto con su caja',
    'item_weight': 'peso del producto sin caja', 'item_display_weight': 'peso del producto',
    'manufacturer_minimum_age': 'edad mínima recomendada en meses',
    'manufacturer_maximum_age': 'edad máxima recomendada en meses',
    'externally_assigned_product_identifier': 'código de barras',
    'supplier_declared_has_product_identifier_exemption': 'exención de código de barras',
    'product_description': 'descripción del producto', 'bullet_point': 'ventajas del producto',
    'generic_keyword': 'palabras de búsqueda', 'item_package_dimensions': 'medidas de la caja',
    'compliance': 'requisitos de seguridad', 'item_dimensions': 'medidas del producto',
    'item_length_width': 'medidas del producto', 'item_length': 'largo del producto',
    'model_name': 'nombre del modelo', 'model_number': 'referencia del modelo',
    'item_package_quantity': 'cantidad de productos en cada paquete',
    'number_of_pieces': 'número de piezas', 'number_of_items': 'cantidad de artículos', 'number_of_players': 'número de jugadores',
    'included_components': 'contenido de la caja', 'color': 'color', 'size': 'tamaño',
    'safety_warning': 'advertencias de seguridad', 'product_site_launch_date': 'fecha de lanzamiento',
    'main_product_image_locator': 'imagen principal', 'supplier_declared_dg_hz_regulation': 'mercancías peligrosas',
    'eu_toys_safety_directive_age_warning': 'advertencia de edad del juguete',
    'eu_toys_safety_directive_warning': 'advertencias de uso del juguete',
    'eu_toys_safety_directive_language': 'idioma de las advertencias',
    'dsa_responsible_party_address': 'contacto de la persona responsable en la Unión Europea',
    'gpsr_manufacturer_reference': 'contacto del fabricante', 'gpsr_safety_attestation': 'información de seguridad',
    'batteries_required': 'pilas necesarias', 'batteries_included': 'pilas incluidas',
    'condition_type': 'estado del producto', 'language': 'idioma', 'chemistry': 'tipo de pila',
    'serial': 'número de serie', 'powered': 'alimentación eléctrica', 'identity': 'identificación del producto',
    'is_assembly_required': 'montaje', 'unit': 'unidad de medida', 'value': 'dato',
    'type': 'tipo', 'kind': 'tipo', 'identifier': 'identificación del producto', 'minimum': 'mínimo', 'maximum': 'máximo', 'width': 'ancho',
    'length': 'largo', 'depth': 'fondo', 'currency': 'moneda', 'quantity': 'cantidad',
    'price': 'precio', 'amount': 'importe', 'media_location': 'enlace del archivo',
}
QUESTIONS = {
    'item_name': '¿Cómo se llama el producto?', 'brand': '¿Cuál es la marca del producto?',
    'manufacturer': '¿Quién fabrica el producto?', 'country_of_origin': '¿En qué país se fabrica?',
    'material': '¿De qué material está hecho el producto?',
    'number_of_pieces': '¿Cuántas piezas incluye el producto?', 'language': '¿En qué idioma está el producto?',
    'batteries_required': '¿Necesita pilas para funcionar?', 'batteries_included': '¿Se incluyen las pilas?',
    'battery_count': '¿Cuántas pilas necesita?', 'num_batteries': '¿Cuántas pilas necesita?',
    'is_assembly_required': '¿Hay que montar el producto antes de usarlo?',
    'manufacturer_minimum_age': '¿A partir de qué edad se recomienda, en meses?',
    'manufacturer_maximum_age': '¿Hasta qué edad se recomienda, en meses?',
    'item_package_weight': '¿Cuánto pesa el producto con su caja?',
    'item_weight': '¿Cuánto pesa el producto sin caja?',
    'included_components': '¿Qué incluye la caja?', 'model_name': '¿Cómo se llama el modelo?',
    'model_number': '¿Cuál es la referencia del modelo?', 'number_of_items': '¿Cuántos artículos incluye?',
    'item_package_quantity': '¿Cuántos productos se venden juntos en cada paquete?',
    'safety_warning': '¿Qué advertencias de seguridad aparecen en el producto o en su caja?',
    'supplier_declared_has_product_identifier_exemption': '¿Amazon permite vender este producto sin código de barras?',
    'externally_assigned_product_identifier': '¿Cuál es el número del código de barras?',
    'eu_toys_safety_directive_age_warning': '¿Qué advertencia de edad lleva el juguete?',
    'eu_toys_safety_directive_warning': '¿Qué otras advertencias de uso lleva el juguete?',
    'eu_toys_safety_directive_language': '¿En qué idioma están las advertencias del juguete?',
    'dsa_responsible_party_address': '¿Cuál es el correo o la web de la persona responsable en la Unión Europea?',
    'gpsr_manufacturer_reference': '¿Cuál es el correo o la web de contacto del fabricante?',
    'gpsr_safety_attestation': '¿Puede usarse con seguridad sin advertencias ni instrucciones de seguridad?',
    'supplier_declared_dg_hz_regulation': '¿Está regulado como mercancía peligrosa?',
    'product_site_launch_date': '¿En qué fecha estará disponible el producto?',
    'main_product_image_locator': '¿Dónde está disponible la imagen principal del producto?',
    'product_description': '¿Cómo describirías el producto?', 'bullet_point': '¿Qué ventaja del producto quieres destacar?',
    'generic_keyword': '¿Con qué palabras buscarían este producto?', 'condition_type': '¿En qué estado se vende?',
    'target_audience_keyword': '¿Para quién está pensado el producto?',
}
FIELD_QUESTIONS = {
    ('fulfillment_availability', 'fulfillment_channel_code'): '¿Cómo vas a enviar los pedidos?',
    ('list_price', 'value_with_tax'): '¿Qué precio de venta recomienda el fabricante?',
}
FIELD_OPTIONS = {
    ('fulfillment_availability', 'fulfillment_channel_code'): {
        'AMAZON_EU': 'Amazon enviará los pedidos (Europa)',
        'DEFAULT': 'Yo enviaré los pedidos',
    },
}
OPTIONS = {
    'other': 'Otro', 'wood': 'Madera', 'plastic': 'Plástico', 'alkaline': 'Alcalina', 'lithium': 'Litio',
    'new_new': 'Nuevo', 'used_like_new': 'Usado, como nuevo', 'used_good': 'Usado, en buen estado',
    'not_applicable': 'No se aplica', 'unknown': 'No lo sé', 'none': 'Ninguno',
    'ean': 'EAN', 'gtin': 'GTIN', 'upc': 'UPC', 'grams': 'Gramos', 'kilograms': 'Kilogramos',
    'centimeters': 'Centímetros', 'millimeters': 'Milímetros', 'meters': 'Metros',
    'months': 'Meses', 'years': 'Años', 'days': 'Días', 'hours': 'Horas',
    'manual': 'Manual de instrucciones', 'original': 'Idioma original',
}
LANGUAGE_ALIASES = [
    {'scots_gaelic', 'gaelic_scots'}, {'inuktitun', 'inuktitut'},
    {'inupiak', 'inupiaq'}, {'lapp', 'sami'}, {'sesotho', 'southern_sotho'},
]


def readable(value):
    text = clean(value, 160)
    return bool(text) and not re.search(r'[_$\\{}\[\]]|\b[a-f0-9]{20,}\b', text, re.I)


def title_for(name, title=None):
    if name in LABELS:
        return LABELS[name]
    if title and readable(title):
        return clean(title)
    raise ValueError('Este dato necesita una explicación más clara antes de poder preguntártelo.')


def question_for(path, node, parent=''):
    root, leaf = path[0], path[-1]
    if (root, leaf) in FIELD_QUESTIONS:
        return FIELD_QUESTIONS[root, leaf]
    if root == 'externally_assigned_product_identifier' and leaf == 'type':
        return '¿Qué tipo de código de barras tiene el producto?'
    if root == 'language' and leaf == 'type':
        return '¿En qué parte del producto se utiliza este idioma?'
    dimension = next((part for part in path[1:] if part in ('length', 'width', 'height', 'depth')), None)
    if dimension:
        subject = f"{LABELS[dimension]} {'de la caja' if root == 'item_package_dimensions' else 'del producto'}"
        article = 'la' if dimension == 'height' else 'el'
        return f'¿En qué unidad está {article} {subject}?' if leaf == 'unit' else f'¿Cuánto mide {article} {subject}?'
    if leaf == 'unit':
        subject = title_for(root, parent).lower()
        return clean(f'¿En qué unidad indicas {subject}?')
    if (leaf == 'value' or len(path) == 1) and root in QUESTIONS:
        return QUESTIONS[root]
    title = title_for(leaf, node.get('title'))
    if leaf == 'value': title = title_for(root, parent or node.get('title'))
    if title.startswith('¿'): return clean(title)
    return clean(f'¿Cuál es {title[:1].lower() + title[1:]}?')


def option_pairs(options, labels, current=None, path=()):
    pairs = []
    field_options = FIELD_OPTIONS.get((path[0], path[-1]), {}) if path else {}
    for option, label in zip(options, labels):
        friendly = field_options.get(str(option)) or (OPTIONS.get(str(option)) if label == option else None)
        label = friendly or clean(label, 160)
        if not readable(label):
            raise ValueError('Las opciones de este dato necesitan una explicación antes de poder elegir.')
        pairs.append((option, label))
    counts = Counter(label for _, label in pairs)
    result = []
    for label in dict.fromkeys(label for _, label in pairs):
        values = [option for option, name in pairs if name == label]
        if counts[label] > 1:
            if not any(set(values) <= aliases for aliases in LANGUAGE_ALIASES):
                raise ValueError('Amazon usa el mismo nombre para varias opciones; necesito distinguirlas antes de preguntarte.')
            values = [current if current in values else values[0]]
        result.append((values[0], label))
    return result


def formats_in(node):
    result = set()
    if isinstance(node, dict):
        if node.get('format'): result.add(str(node['format']))
        for key in ('anyOf', 'oneOf', 'allOf'):
            for branch in node.get(key, []): result.update(formats_in(branch))
    return result


def pattern_hint(pattern):
    # Translate only patterns whose meaning is known, never display raw expressions.
    match = re.fullmatch(r'\^\[0-9\]\{(\d+)(?:,(\d+))?\}\$', pattern)
    if match:
        low, high = match.groups()
        return f'Escribe {low} dígitos, sin espacios.' if not high else f'Escribe entre {low} y {high} dígitos, sin espacios.'
    if re.fullmatch(r'\^[\w áéíóúüñÁÉÍÓÚÜÑ-]+\$', pattern):
        return f'Escribe «{pattern[1:-1]}». '
    if pattern in (r'^\d+$', r'^[0-9]+$'):
        return 'Usa solo dígitos, sin espacios ni signos.'
    if pattern in (r'^[A-Z0-9]+$',):
        return 'Usa solo letras mayúsculas y números, sin espacios.'
    return 'Amazon exige un formato concreto; comprobaré tu respuesta antes de guardarla.'


def hint_for(node, kind, field, value=None):
    hints = []
    if value is not None: hints.append('El dato guardado necesita una corrección.')
    if field.get('closed'): hints.append('Elige una de las opciones aceptadas por Amazon.')
    elif field.get('options'): hints.append('Elige una opción o escribe tu respuesta.')
    if kind == 'integer': hints.append('Escribe un número entero, sin decimales.')
    elif kind == 'number': hints.append('Escribe solo el número; puedes usar coma para los decimales.')
    formats = formats_in(node)
    for fmt in sorted(formats):
        explanation = {'date': 'Escribe la fecha como año-mes-día; por ejemplo, 2026-10-15.',
            'date-time': 'Si incluyes la hora, usa año-mes-día y hora; por ejemplo, 2026-10-15T12:00:00Z.',
            'uri': 'Pega el enlace completo del archivo, comenzando por https y sin espacios.',
            'uri-reference': 'Pega el enlace del archivo, sin espacios.',
            'email': 'Escribe una dirección de correo, por ejemplo, contacto@tumarca.es.',
            'hostname': 'Escribe el dominio de la web, por ejemplo, tumarca.es.',
            'time': 'Escribe la hora con segundos y zona horaria; por ejemplo, 12:00:00Z.'}.get(fmt)
        hints.append(explanation or 'Comprobaré que tu respuesta tenga el formato que acepta Amazon.')
    # Los límites numéricos se explican cuando se incumplen, sin abrumar con
    # máximos técnicos ni repetir un mínimo inclusivo y otro exclusivo.
    for key, text in [('minLength', 'Mínimo de caracteres'), ('maxLength', 'Máximo de caracteres')]:
        if key in node: hints.append(f'{text}: {node[key]}.')
    if 'multipleOf' in node: hints.append(f'Usa cantidades en incrementos de {node["multipleOf"]}.')
    if 'minUtf8ByteLength' in node or 'maxUtf8ByteLength' in node:
        hints.append('El límite de texto de Amazon también depende de los símbolos utilizados; comprobaré que encaje.')
    if 'pattern' in node: hints.append(pattern_hint(node['pattern']))
    return ' '.join(hints)[:600]


def number_text(value):
    """Límite legible, sin decimales vacíos ni notación del esquema."""
    whole, _, fraction = format(Decimal(str(value)), 'f').partition('.')
    fraction = fraction.rstrip('0')
    sign = '-' if whole.startswith('-') else ''
    digits = whole.lstrip('-')
    grouped = '.'.join(reversed([digits[max(0, end - 3):end] for end in range(len(digits), 0, -3)]))
    return sign + grouped + (',' + fraction if fraction else '')


def answer_error(errors):
    """Una regla accionable; prevalece el límite más restrictivo que se incumplió."""
    for rules, reverse in [(('minimum', 'exclusiveMinimum'), True), (('maximum', 'exclusiveMaximum'), False)]:
        bounds = [error for error in errors if error.validator in rules]
        if bounds:
            selected = sorted(bounds, key=lambda error: (Decimal(str(error.validator_value)),
                error.validator.startswith('exclusive') if reverse else not error.validator.startswith('exclusive')),
                reverse=reverse)[0]
            return error_message(selected)
    return error_message(errors[0])


def number_error(field, spec, reason, separate_unit=False):
    if reason == 'precision':
        message = 'Este número tiene más cifras de las que podemos guardar. Revisa el valor y los decimales.'
    elif reason == 'integer':
        message = 'Escribe un número entero, sin decimales.'
    else:
        message = ('Escribe solo el número, sin letras ni unidades.' if separate_unit else
                   'Escribe solo el número, sin letras.')
        if spec['type'] == 'integer': message += ' Debe ser un número entero, sin decimales.'
        else: message += ' Puedes usar coma para los decimales.'
    if separate_unit: message += ' La unidad se elige aparte.'
    return f'«{field["label"]}»: {message}'


def error_message(error):
    rule, limit = error.validator, error.validator_value
    bounds = {'minimum': 'El valor debe ser {} o mayor.', 'maximum': 'El valor debe ser {} o menor.',
              'exclusiveMinimum': 'El valor debe ser mayor que {}.', 'exclusiveMaximum': 'El valor debe ser menor que {}.'}
    if rule in bounds: return bounds[rule].format(number_text(limit))
    messages = {'required': 'Completa los datos que faltan en esta respuesta.',
        'enum': 'Elige una de las opciones disponibles.', 'type': 'Revisa el tipo de respuesta que se pide.',
        'pattern': pattern_hint(str(limit)), 'anyOf': 'Esta respuesta no tiene un formato admitido. Revisa la ayuda del campo.',
        'oneOf': 'Esta respuesta no permite identificar una única opción. Revisa la ayuda del campo.',
        'format': 'Revisa el formato indicado debajo de la pregunta.',
        'additionalProperties': 'La respuesta incluye datos que este campo no admite.',
        'minLength': f'Escribe al menos {limit} caracteres.', 'maxLength': f'Usa como máximo {limit} caracteres.',
        'maxUtf8ByteLength': 'El texto ocupa demasiado espacio para Amazon. Acórtalo o reduce los símbolos especiales.',
        'minUtf8ByteLength': 'El texto es demasiado corto para Amazon. Amplía la respuesta.',
        'multipleOf': f'Usa cantidades en incrementos de {limit}.',
        'uniqueItems': 'Hay elementos repetidos; conserva una sola copia de cada uno.',
        'maxItems': f'Incluye como máximo {limit} elementos.', 'minItems': f'Incluye al menos {limit} elementos.'}
    return messages.get(rule, 'Revisa esta respuesta para que cumpla lo que pide Amazon.')

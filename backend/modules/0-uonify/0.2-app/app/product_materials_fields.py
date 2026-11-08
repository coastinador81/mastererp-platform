"""Canonicalización conservadora: un atributo semántico mantiene un destino estable."""
import hashlib
import re
import unicodedata


def normalized_label(label):
    value = unicodedata.normalize('NFKD', label if isinstance(label, str) else '')
    value = ''.join(character for character in value if not unicodedata.combining(character))
    return re.sub(r'[\W_]+', ' ', value.casefold()).strip()


ALIASES = {
    'name': {'nombre', 'nombre producto', 'nombre del producto', 'name', 'product name',
             'titulo del producto', 'titulo producto', 'product title'},
    'brand': {'marca', 'marca comercial', 'brand', 'brand name', 'nombre de la marca'},
    'category': {'categoria', 'categoria del producto', 'category', 'product category',
                 'tipo producto', 'tipo de producto', 'product type', 'categoria propuesta',
                 'categoria declarada', 'categoria diseno 3d'},
    'description': {'descripcion', 'descripcion del producto', 'description', 'product description'},
    'bullets': {'vinetas', 'vinetas del producto', 'puntos clave', 'puntos clave del producto',
               'bullet points', 'bullets', 'key points'},
    'keywords': {'palabras clave', 'palabras clave de busqueda', 'terminos de busqueda',
                 'keywords', 'search terms', 'search keywords'},
}

CUSTOM_ALIASES = {
    'ean_gtin_13': {'ean', 'ean 13', 'gtin', 'gtin 13', 'ean gtin', 'ean gtin 13',
                    'codigo ean', 'codigo ean 13', 'codigo de barras ean', 'codigo gtin', 'product id', 'barcode',
                    'ean digital', 'ean visible declarado', 'ean digital decodificado', 'verificacion ean digital',
                    'comprobacion digital del ean'},
    'edad_minima': {'edad', 'edad minima', 'edad minima recomendada', 'edad recomendada',
                    'edad recomendada minima', 'rango de edad', 'edad de uso', 'age', 'minimum age', 'edad minima prevista', 'edad declarada', 'edad prevista declarada'},
    'material': {'material', 'material principal', 'material del producto', 'material de las piezas',
                 'material base', 'material declarado', 'main material'},
    'fabricante': {'fabricante', 'nombre del fabricante', 'empresa fabricante',
                   'razon social del fabricante', 'manufacturer', 'manufacturer name', 'fabricante razon social', 'fabricante declarado'},
    'modelo': {'modelo', 'modelo del producto', 'nombre del modelo', 'model', 'model name'},
    'pais_fabricacion': {'pais de fabricacion', 'pais de origen', 'origen', 'country of origin', 'made in', 'origen declarado'},
    'numero_piezas': {'numero de piezas', 'cantidad de piezas', 'cantidad de bloques', 'numero de bloques',
                      'piezas', 'total de piezas', 'number of pieces', 'piece count', 'bloques de juego'},
    'contenido_del_set': {'contenido del set', 'contenido del juego', 'contenido de la caja',
                          'contenido del paquete', 'incluido en la caja', 'package contents'},
    'persona_responsable': {'persona responsable', 'persona responsable ue', 'responsable ue',
                            'eu responsible person'},
    'lote': {'lote', 'numero de lote', 'codigo de lote', 'batch', 'batch number', 'lote declarado'},
    'dimensiones_producto': {'dimensiones', 'dimensiones del producto', 'medidas del producto',
                              'product dimensions'},
    'dimensiones_pieza': {'dimensiones de pieza', 'dimensiones de la pieza', 'dimensiones de las piezas',
                          'medidas de las piezas', 'medidas del bloque', 'dimensiones del bloque', 'dimensiones de la pieza mm',
                          'dimensiones nominales de pieza', 'medida nominal del bloque'},
    'dimensiones_torre': {'dimensiones de la torre mm', 'dimensiones nominales torre montada',
                           'medida nominal de torre montada', 'dimensiones de torre preservadas'},
    'dimensiones_caja': {'dimensiones nominales caja cerrada', 'medida nominal de caja cerrada',
                         'dimensiones de caja propuestas'},
    'pieza_largo': {'pieza largo', 'longitud nominal de pieza'},
    'pieza_ancho': {'pieza ancho', 'anchura nominal de pieza'},
    'pieza_alto': {'pieza alto', 'altura nominal de pieza'},
    'peso_producto': {'peso', 'peso del producto', 'peso neto', 'product weight', 'net weight'},
}

# Equivalencias cerradas del vocabulario documental. No fusionar dimensiones de
# partes diferentes, fabricante/importador ni texto de caras opuestas.
EXTRA_ALIASES = {
    'ean_gtin_13': {'codigo de barras ean 13', 'codigo de barras gtin 13', 'ean verificado digitalmente'},
    'edad_minima': {'edad recomendada declarada'},
    'pais_fabricacion': {'pais de origen declarado', 'pais de fabricacion declarado'},
    'persona_responsable': {'responsable ue razon social', 'persona responsable ue declarada'},
    'fabricante_correo': {'fabricante correo', 'correo del fabricante', 'contacto del fabricante', 'email del fabricante'},
    'fabricante_direccion': {'fabricante direccion', 'direccion del fabricante', 'direccion del fabricante declarada'},
    'contacto_correo': {'correo de contacto', 'correo electronico de contacto'},
    'niveles_torre': {'niveles de la torre', 'niveles torre', 'torre niveles', 'numero de niveles', 'levels'},
    'numero_personajes': {'personajes servicios', 'numero de personajes', 'personajes en el modelo'},
    'bloques_por_servicio': {'bloques por servicio', 'piezas por servicio'},
    'parejas_frases': {'parejas de frases distintas', 'parejas de frases', 'numero de parejas de frases'},
    'alternancia_niveles': {'alternancia entre niveles', 'alternancia de niveles', 'angulo entre niveles'},
    'base_dimensiones_exteriores': {'base dimensiones exteriores', 'base exterior'},
    'tapa_dimensiones_exteriores': {'tapa dimensiones exteriores', 'tapa exterior'},
    'dimensiones_guia': {'dimensiones de la guia', 'guia dimensiones', 'guia propuesta'},
    'distribucion_embalaje': {'distribucion del embalaje', 'distribucion interior del embalaje', 'distribucion interior'},
    'advertencia_seguridad': {'advertencia de seguridad', 'advertencia y peligro', 'advertencias y peligro', 'advertencia y peligro confirmados'},
    'simbolos_presentes_en_el_arte': {'simbolos presentes en el arte', 'simbolos graficos presentes'},
    'packaging_vigente': {'packaging vigente', 'estado del packaging'},
    'idiomas_del_envase': {'idiomas del envase', 'idiomas de instrucciones y advertencias',
                           'idiomas del bloque de instrucciones y advertencias del envase', 'idiomas del empaque'},
    'espesores_caja_separadores': {'espesores propuestos', 'espesores propuestos caja separadores'},
    'frase_superior': {'frase superior declarada', 'frase superior visible', 'texto superior visible',
                       'texto impreso superior', 'texto superior impreso', 'inscripcion superior',
                       'frase superior declarada en diseno 3d'},
    'frase_inferior': {'frase inferior declarada', 'frase inferior visible', 'texto inferior visible',
                       'texto impreso inferior', 'texto inferior impreso', 'inscripcion inferior',
                       'frase inferior declarada en diseno 3d'},
    'texto_impreso': {'texto impreso', 'texto impreso visible', 'texto impreso en la pieza',
                      'frase impresa visible', 'frase impresa declarada', 'frase decorativa'},
    'motor_render': {'motor de render', 'motor de renderizado', 'motor de renderizado 3d'},
    'dispositivo_render': {'dispositivo de renderizado', 'dispositivo de render'},
    'formato_render': {'formato de renderizado', 'formato de imagen 3d'},
    'resolucion_render': {'resolucion de render', 'resolucion de renderizado declarado'},
    'objeto_fuente': {'objeto fuente 3d', 'objeto de origen'},
    'escena_3d': {'escena de pieza 3d', 'escena de diseno 3d'},
}
for _key, _names in EXTRA_ALIASES.items():
    CUSTOM_ALIASES.setdefault(_key, set()).update(_names)

LABELS = {
    'name': 'Nombre del producto', 'brand': 'Marca', 'category': 'Tipo de producto',
    'description': 'Descripción', 'bullets': 'Puntos clave', 'keywords': 'Palabras clave',
    'ean_gtin_13': 'EAN / GTIN-13', 'edad_minima': 'Edad mínima', 'material': 'Material',
    'fabricante': 'Fabricante', 'modelo': 'Modelo', 'pais_fabricacion': 'País de fabricación',
    'numero_piezas': 'Número de piezas', 'contenido_del_set': 'Contenido del set',
    'persona_responsable': 'Persona responsable UE', 'lote': 'Lote',
    'dimensiones_producto': 'Dimensiones del producto', 'dimensiones_pieza': 'Dimensiones de la pieza',
    'peso_producto': 'Peso del producto',
}


def _custom_label(normalized):
    identifier = re.sub(r'[^a-z0-9]+', '_', normalized).strip('_')
    if not identifier or not identifier[0].isalpha():
        identifier = 'attribute_' + identifier
    if len(identifier) > 64 or identifier == 'attribute_':
        identifier = identifier[:47].rstrip('_') + '_' + hashlib.sha256(normalized.encode()).hexdigest()[:16]
    return 'custom:' + identifier


def canonical_field(field, label):
    """El rótulo debe autorizar el destino; los alias custom no dependen del ID de la IA."""
    normalized = normalized_label(label)
    if isinstance(field, str) and field in ALIASES and normalized in ALIASES[field]:
        return field
    for key, names in CUSTOM_ALIASES.items():
        if normalized in names:
            return 'custom:' + key
    if isinstance(field, str) and re.fullmatch(r'custom:[a-zA-Z][a-zA-Z0-9_-]{0,63}', field):
        # Sin alias conocido conservar un ID explícito; la consolidación usa el rótulo.
        return field
    return _custom_label(normalized)


def canonical_attribute(field, label):
    """Normaliza propuestas ya extraídas, incluso si el modelo varió el ID custom."""
    normalized = normalized_label(label)
    for key, names in {**ALIASES, **CUSTOM_ALIASES}.items():
        if normalized in names:
            return key if key in ALIASES else 'custom:' + key
    return _custom_label(normalized)


def canonical_label(field, fallback):
    return LABELS.get(field.removeprefix('custom:'), fallback)


def field_aliases(field, label):
    key = field.removeprefix('custom:')
    return ALIASES.get(key, CUSTOM_ALIASES.get(key, {normalized_label(label)}))

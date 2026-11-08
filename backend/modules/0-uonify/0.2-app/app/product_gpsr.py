"""GPSR por marca y por producto: validación, herencia y puerta de publicación UE.

Modelo alineado con la especificación de cumplimiento del hilo Legal
(docs/legal/GPSR-REQUISITOS-PUBLICACION-UE.md · Reglamento (UE) 2023/988, art. 19).

Dos perfiles:
- MARCA (apartado 2): fabricante (nombre, dirección postal, correo) y, si el
  fabricante no está en la UE, persona responsable en la UE (tipo, nombre,
  dirección en la UE, correo); importador y canal de reclamaciones opcionales.
- PRODUCTO (apartado 3): fabricante propio si difiere, modelo, identificadores,
  advertencias por lengua o declaración de que no hacen falta, países de venta,
  aviso de legislación propia y la declaración del vendedor.

La HERENCIA (apartado 4) lleva fabricante y responsable de la marca al producto.
La PUERTA (apartado 5) bloquea la publicación en la UE mientras falte algo; fuera
de la UE se puede publicar enseñando qué falta. El encaje con los atributos de
seguridad de Amazon (apartado 7) lo aporta el hilo Amazon y se suma a la puerta.

Módulo PURO (solo biblioteca estándar): verificable en aislamiento. Cumple la
regla de Uony (apartado 6): no inventa; una traducción propuesta por IA queda
marcada `ai_proposed` para que el vendedor la revise. La validación comprueba
forma y formato; los OBLIGATORIOS para publicar se comprueban en la puerta.
"""
import json
import re

EMAIL = re.compile(r'[^@\s]+@[^@\s]+\.[^@\s]+')
ISO2 = re.compile(r'[A-Z]{2}')
EU_LANGS = {
    'ES': ('es',), 'PT': ('pt',), 'FR': ('fr',), 'DE': ('de',), 'IT': ('it',),
    'NL': ('nl',), 'AT': ('de',), 'PL': ('pl',), 'SE': ('sv',), 'DK': ('da',),
    'CZ': ('cs',), 'SK': ('sk',), 'HU': ('hu',), 'RO': ('ro',), 'BG': ('bg',),
    'GR': ('el',), 'HR': ('hr',), 'SI': ('sl',), 'EE': ('et',), 'LV': ('lv',),
    'LT': ('lt',), 'BE': ('nl', 'fr', 'de'), 'LU': ('fr', 'de'), 'IE': ('en', 'ga'),
    'FI': ('fi', 'sv'), 'MT': ('mt', 'en'), 'CY': ('el', 'en'),
}
EU_COUNTRIES = frozenset(EU_LANGS)
RESPONSIBLE_TYPES = {'importador', 'representante_autorizado', 'prestador_logistica'}
POSTAL_KEYS = {'street', 'postal_code', 'city', 'country'}
PARTY_KEYS = {'name', 'postal_address', 'email', 'point_of_contact'}
VALUE_MAX = 500
TEXT_MAX = 4000
MAX_BYTES = 60000


def _fail(message):
    raise ValueError(message)


def _text(value, limit=VALUE_MAX):
    if not isinstance(value, str):
        _fail('Cada dato GPSR es un texto.')
    value = value.strip()
    if len(value) > limit:
        _fail('Un dato GPSR supera la longitud permitida.')
    return value


def _postal(value):
    if not isinstance(value, dict) or set(value) - POSTAL_KEYS:
        _fail('Revisa la dirección postal GPSR.')
    clean = {}
    for key in POSTAL_KEYS:
        if key not in value:
            continue
        text = _text(value[key])
        if not text:
            continue
        if key == 'country':
            text = text.upper()
            if not ISO2.fullmatch(text):
                _fail('El país debe ser un código ISO de dos letras.')
        clean[key] = text
    return clean


def _party(value):
    if not isinstance(value, dict) or set(value) - PARTY_KEYS:
        _fail('Revisa los datos de fabricante o responsable.')
    clean = {}
    if 'name' in value and (name := _text(value['name'])):
        clean['name'] = name
    if 'email' in value and (email := _text(value['email'])):
        if not EMAIL.fullmatch(email):
            _fail('El correo GPSR no tiene un formato válido.')
        clean['email'] = email
    if 'point_of_contact' in value and (poc := _text(value['point_of_contact'])):
        clean['point_of_contact'] = poc
    if 'postal_address' in value:
        postal = _postal(value['postal_address'])
        if postal:
            clean['postal_address'] = postal
    return clean


def _responsible(value):
    if not isinstance(value, dict) or set(value) - (PARTY_KEYS | {'type'}):
        _fail('Revisa la persona responsable en la UE.')
    clean = _party({k: v for k, v in value.items() if k != 'type'})
    if 'type' in value and (kind := _text(value['type'])):
        if kind not in RESPONSIBLE_TYPES:
            _fail('El tipo de responsable debe ser importador, representante autorizado o prestador de logística.')
        clean['type'] = kind
    return clean


def _size_guard(value):
    if len(json.dumps(value, ensure_ascii=False).encode('utf-8')) > MAX_BYTES:
        _fail('Los datos GPSR superan el tamaño permitido.')


BRAND_KEYS = {'manufacturer', 'eu_responsible', 'importer', 'complaints_channel', 'amazon_compliance'}


def validate_brand_gpsr(value):
    """Valida y normaliza el perfil GPSR de una marca (apartado 2). No impone
    obligatorios: la completitud se comprueba con brand_profile_missing / la puerta."""
    if value in (None, {}):
        return {}
    if not isinstance(value, dict) or set(value) - BRAND_KEYS:
        _fail('Revisa la estructura del perfil GPSR de la marca.')
    _size_guard(value)
    clean = {}
    if 'manufacturer' in value and (m := _party(value['manufacturer'])):
        clean['manufacturer'] = m
    if 'eu_responsible' in value and (r := _responsible(value['eu_responsible'])):
        clean['eu_responsible'] = r
    if 'importer' in value and (i := _party(value['importer'])):
        clean['importer'] = i
    if 'complaints_channel' in value and (c := _text(value['complaints_channel'])):
        clean['complaints_channel'] = c
    if 'amazon_compliance' in value and (ac := _store_confirmations(value['amazon_compliance'])):
        clean['amazon_compliance'] = ac
    return clean


PRODUCT_KEYS = {'own_manufacturer', 'model', 'identifiers', 'warnings',
                'no_warnings_declaration', 'countries_of_sale', 'sector_legislation',
                'seller_declaration', 'amazon_compliance'}
IDENTIFIER_KEYS = {'gtin', 'ean', 'manufacturer_ref', 'sku'}


def _warnings(value):
    if not isinstance(value, list) or len(value) > 60:
        _fail('Revisa las advertencias de seguridad.')
    clean = []
    for entry in value:
        if not isinstance(entry, dict) or set(entry) - {'lang', 'text', 'ai_proposed', 'source'}:
            _fail('Revisa una advertencia de seguridad.')
        lang = _text(entry.get('lang', ''), 8).lower()
        text = _text(entry.get('text', ''), TEXT_MAX)
        if not lang or not text:
            _fail('Cada advertencia necesita lengua y texto.')
        item = {'lang': lang, 'text': text}
        if entry.get('ai_proposed'):
            if not isinstance(entry['ai_proposed'], bool):
                _fail('Marca de traducción no válida.')
            item['ai_proposed'] = True
        if entry.get('source'):
            item['source'] = _text(entry['source'])
        clean.append(item)
    return clean


def validate_product_gpsr(value):
    """Valida y normaliza los datos GPSR propios de un producto (apartado 3)."""
    if value in (None, {}):
        return {}
    if not isinstance(value, dict) or set(value) - PRODUCT_KEYS:
        _fail('Revisa la estructura de los datos GPSR del producto.')
    _size_guard(value)
    clean = {}
    if 'own_manufacturer' in value and (m := _party(value['own_manufacturer'])):
        clean['own_manufacturer'] = m
    if 'model' in value and (model := _text(value['model'])):
        clean['model'] = model
    if 'identifiers' in value:
        ids = value['identifiers']
        if not isinstance(ids, dict) or set(ids) - IDENTIFIER_KEYS:
            _fail('Revisa los identificadores del producto.')
        clean_ids = {k: _text(ids[k], 200) for k in IDENTIFIER_KEYS if ids.get(k) and _text(ids[k], 200)}
        if clean_ids:
            clean['identifiers'] = clean_ids
    if value.get('warnings'):
        clean['warnings'] = _warnings(value['warnings'])
    if value.get('no_warnings_declaration'):
        if not isinstance(value['no_warnings_declaration'], bool):
            _fail('La declaración de advertencias no es válida.')
        clean['no_warnings_declaration'] = True
    if 'countries_of_sale' in value:
        countries = value['countries_of_sale']
        if not isinstance(countries, list) or len(countries) > 27:
            _fail('Revisa los países de venta.')
        clean_countries = []
        for country in countries:
            code = _text(country, 2).upper()
            if not ISO2.fullmatch(code):
                _fail('Cada país de venta es un código ISO de dos letras.')
            if code not in clean_countries:
                clean_countries.append(code)
        if clean_countries:
            clean['countries_of_sale'] = clean_countries
    if 'sector_legislation' in value:
        sectors = value['sector_legislation']
        if not isinstance(sectors, list) or any(not isinstance(s, str) or len(s) > 200 for s in sectors):
            _fail('Revisa el aviso de legislación propia.')
        if sectors:
            clean['sector_legislation'] = [s.strip() for s in sectors if s.strip()]
    if 'seller_declaration' in value:
        decl = value['seller_declaration']
        if not isinstance(decl, dict) or set(decl) - {'accepted', 'at', 'by'}:
            _fail('Revisa la declaración del vendedor.')
        if decl.get('accepted') is True:
            clean['seller_declaration'] = {'accepted': True, 'at': _text(decl.get('at', '')), 'by': _text(decl.get('by', ''))}
    # Confirmación del alta en Seller Central a nivel de PRODUCTO: solo para marcas SIN Brand
    # Registry (Amazon obliga a darla por SKU). Con Brand Registry va a nivel de marca.
    if 'amazon_compliance' in value and (ac := _store_confirmations(value['amazon_compliance'])):
        clean['amazon_compliance'] = ac
    return clean


def _party_complete(party, require_eu_country):
    missing = []
    if not party.get('name'):
        missing.append('name')
    postal = party.get('postal_address', {})
    for key in ('street', 'postal_code', 'city', 'country'):
        if not postal.get(key):
            missing.append('postal_' + key)
    if not party.get('email'):
        missing.append('email')
    if require_eu_country and postal.get('country') and postal['country'] not in EU_COUNTRIES:
        missing.append('country_not_eu')
    return missing


def manufacturer_in_eu(brand):
    country = brand.get('manufacturer', {}).get('postal_address', {}).get('country')
    return country in EU_COUNTRIES if country else None


def brand_profile_missing(brand_profile):
    """Qué falta para que el perfil GPSR de una marca esté COMPLETO (apartado 2/5.1).
    Devuelve una lista de códigos; vacía = completo."""
    brand = validate_brand_gpsr(brand_profile)
    missing = ['manufacturer_' + code for code in _party_complete(brand.get('manufacturer', {}), False)]
    in_eu = manufacturer_in_eu(brand)
    if in_eu is None:
        pass  # sin país de fabricante no se puede decidir; ya se exige la dirección arriba
    elif not in_eu:
        responsible = brand.get('eu_responsible', {})
        if not responsible.get('type'):
            missing.append('eu_responsible_type')
        missing += ['eu_responsible_' + code for code in _party_complete(responsible, True)]
    return missing


DECLARATION_ES = ('Confirmo que este producto es seguro y cumple la normativa de la UE que le es aplicable, '
                  'incluido el Reglamento (UE) 2023/988. Los datos del fabricante, de la persona responsable '
                  'y de seguridad son correctos y figuran también en el producto, en su envase o en un documento '
                  'que lo acompaña.')
DECLARATION_EN = ('I confirm that this product is safe and complies with the EU legislation that applies to it, '
                  'including Regulation (EU) 2023/988. The manufacturer, responsible person and safety information '
                  'is correct and also appears on the product, its packaging or an accompanying document.')


def _warnings_missing(product):
    if product.get('no_warnings_declaration'):
        return []
    missing = []
    langs = {w['lang'] for w in product.get('warnings', [])}
    for country in product.get('countries_of_sale', []):
        accepted = EU_LANGS.get(country)
        if not accepted:
            missing.append('warnings_unknown_country_' + country)
        elif len(accepted) > 1:
            if not any(lang in langs for lang in accepted):
                missing.append('warnings_review_' + country)
        elif accepted[0] not in langs:
            missing.append('warnings_' + country)
    return missing


def _effective_brand(brand, product):
    """Perfil de marca efectivo: la marca, con el fabricante del producto si este
    declara uno propio (apartado 4: el fabricante propio prevalece)."""
    if product.get('own_manufacturer'):
        return {**brand, 'manufacturer': product['own_manufacturer']}
    return brand


def resolve_product_gpsr(brand_profile, product_profile):
    """GPSR efectivo del producto (apartado 4): hereda fabricante y responsable de
    la marca; si el producto declara `own_manufacturer`, este prevalece. Pura."""
    brand = validate_brand_gpsr(brand_profile)
    product = validate_product_gpsr(product_profile)
    effective = dict(product)
    effective.pop('own_manufacturer', None)
    manufacturer = product.get('own_manufacturer') or brand.get('manufacturer')
    if manufacturer:
        effective['manufacturer'] = manufacturer
    for key in ('eu_responsible', 'importer', 'complaints_channel'):
        if brand.get(key):
            effective.setdefault(key, brand[key])
    return effective


def eu_publish_gate(brand_profile, product_profile, *, has_image, has_identifier):
    """Puerta de publicación en la UE (apartado 5). Pura: recibe hechos de la ficha
    (imagen/identificador) en vez de leer la base de datos. Devuelve qué bloquea.
    El encaje con los atributos de Amazon (apartado 7) se añade aparte cuando el
    hilo Amazon entregue la tabla; aquí se marca como pendiente, no como cumplido."""
    brand = validate_brand_gpsr(brand_profile)
    product = validate_product_gpsr(product_profile)
    missing = ['brand_' + code for code in brand_profile_missing(_effective_brand(brand, product))]
    if not product.get('model'):
        missing.append('model')
    if not (has_identifier or product.get('identifiers')):
        missing.append('identifier')
    if not has_image:
        missing.append('image')
    if not product.get('countries_of_sale'):
        missing.append('countries_of_sale')
    missing += _warnings_missing(product)
    declaration = product.get('seller_declaration')
    if not (declaration and declaration.get('accepted') and declaration.get('at') and declaration.get('by')):
        missing.append('seller_declaration')
    return {'blocked_in_eu': bool(missing), 'missing': missing, 'can_publish_outside_eu': True}


# --- Encaje con Amazon (apartado 7 de la especificación de Legal) ---
# Una sola fuente de verdad del mapeo vía A (atributos de la ficha que envía el hilo
# Amazon al publicar). La dirección postal del fabricante y la persona responsable
# NO van aquí: van por la vía B, el panel «Manage Your Compliance» de la marca.
AMAZON_ATTRIBUTE_MAP = {
    'manufacturer.name': 'manufacturer',
    'manufacturer.email': 'gpsr_manufacturer_reference.gpsr_manufacturer_email_address (por ASIN)',
    'responsible.email': 'dsa_responsible_party_address (por SKU y por tienda; es del GPSR pese al prefijo DSA)',
    'model': 'model_number',
    'identifier': 'externally_assigned_product_identifier',
    'image': 'main_product_image_locator',
    'warnings[lang]': 'safety_warning (language_tag)',
    'no_warnings_declaration': 'gpsr_safety_attestation',
}
# Casilla de confirmación del alta en Seller Central (regla 9 de Legal).
# FUENTE CANÓNICA Y TEXTO LEGAL DEFINITIVO: docs/legal/GPSR-REQUISITOS-PUBLICACION-UE.md, §7 regla 9
# (versión inglesa en docs/legal/en/). No reescribir aquí: cualquier cambio se hace primero en §7 y se copia
# TEXTUAL en ambos sitios y en los dos idiomas. {tiendas}/{stores} = las tiendas que cubre la casilla.
# Son DOS variantes (regla 9): CON Brand Registry, una casilla por MARCA; SIN él, una por PRODUCTO.
AMAZON_COMPLIANCE_CONFIRM = {
    # Con Brand Registry: casilla por marca (cubre todos sus productos).
    'brand': {
        'es': ('Esta marca está inscrita en el Registro de Marcas de Amazon (Brand Registry). He dado de '
               'alta en Seller Central de Amazon, para {tiendas}, al fabricante de esta marca y a su persona '
               'responsable en la UE, con su nombre, su dirección postal y su correo. Los correos son los '
               'mismos que he puesto en Uonify.'),
        'en': ("This brand is enrolled in Amazon Brand Registry. In Amazon Seller Central, for {stores}, I "
               "have registered this brand's manufacturer and its EU responsible person, with their name, "
               "postal address and email. The email addresses are the same as the ones I entered in Uonify."),
    },
    # Sin Brand Registry: casilla por producto.
    'product': {
        'es': ('He dado de alta en Seller Central de Amazon, para {tiendas}, al fabricante de este producto '
               'y a su persona responsable en la UE, con su nombre, su dirección postal y su correo. Los '
               'correos son los mismos que he puesto en Uonify.'),
        'en': ("In Amazon Seller Central, for {stores}, I have registered this product's manufacturer and its "
               "EU responsible person, with their name, postal address and email. The email addresses are the "
               "same as the ones I entered in Uonify."),
    },
}
# Compatibilidad con los nombres antiguos (= variante por marca, con Brand Registry).
AMAZON_COMPLIANCE_CONFIRM_ES = AMAZON_COMPLIANCE_CONFIRM['brand']['es']
AMAZON_COMPLIANCE_CONFIRM_EN = AMAZON_COMPLIANCE_CONFIRM['brand']['en']


def _confirmation(value):
    # Guarda, además de confirmed/at/by, la VERSIÓN del texto mostrado y los CORREOS a los que se
    # refiere (Legal): si cambian los correos de la marca, la confirmación queda obsoleta y se vuelve a pedir.
    if not isinstance(value, dict) or set(value) - {'confirmed', 'at', 'by', 'textVersion', 'emails'}:
        _fail('Revisa la confirmación guardada (fecha, usuario, texto y correos).')
    if value.get('confirmed') is not True:
        return {}
    clean = {'confirmed': True, 'at': _text(value.get('at', '')), 'by': _text(value.get('by', ''))}
    if value.get('textVersion'):
        clean['textVersion'] = _text(value['textVersion'], 80)
    emails = value.get('emails')
    if emails:
        if not isinstance(emails, dict) or set(emails) - {'manufacturer', 'responsible'}:
            _fail('Revisa los correos de la confirmación.')
        clean_emails = {}
        for role in ('manufacturer', 'responsible'):
            if emails.get(role):
                address = _text(emails[role])
                if not EMAIL.fullmatch(address):
                    _fail('El correo de la confirmación no es válido.')
                clean_emails[role] = address
        if clean_emails:
            clean['emails'] = clean_emails
    return clean


def _store_confirmations(value):
    """La casilla de la vía B va POR TIENDA UE (Amazon: alta separada por tienda). Mapa
    {tienda ISO2: {confirmed, at, by}}. Con Brand Registry se guarda en la marca; sin él, por SKU."""
    if not isinstance(value, dict):
        _fail('La confirmación de Amazon va por tienda.')
    clean = {}
    for store, conf in value.items():
        code = _text(store, 2).upper()
        if not ISO2.fullmatch(code):
            _fail('Cada tienda de la confirmación es un código ISO2.')
        confirmation = _confirmation(conf)
        if confirmation:
            clean[code] = confirmation
    return clean


def amazon_safety_attestation(product_profile):
    """gpsr_safety_attestation: True SOLO si el vendedor declaró que el producto no
    necesita advertencias (regla 3 de Legal). Nunca por defecto ni propuesto por Uony."""
    return bool(validate_product_gpsr(product_profile).get('no_warnings_declaration'))


def amazon_attributes(brand_profile, product_profile, store_country):
    """Construye el payload GPSR de la vía A para una tienda de Amazon (no lo envía:
    el hilo Amazon lo manda por SP-API). Una sola fuente del mapeo, compartida."""
    effective = resolve_product_gpsr(brand_profile, product_profile)
    product = validate_product_gpsr(product_profile)
    store = _text(store_country, 2).upper()
    lang = (EU_LANGS.get(store) or ('',))[0]
    attrs = {}
    manufacturer = effective.get('manufacturer', {})
    if manufacturer.get('name'):
        attrs['manufacturer'] = manufacturer['name']
    if manufacturer.get('email'):
        attrs['gpsr_manufacturer_reference'] = {'gpsr_manufacturer_email_address': manufacturer['email']}
    # Correo de la persona responsable (regla 4 de Legal: si el fabricante está en la UE,
    # es su propia persona responsable). dsa_responsible_party_address es del GPSR (regla 136).
    country = manufacturer.get('postal_address', {}).get('country')
    manufacturer_eu = country in EU_COUNTRIES if country else False
    responsible_email = effective.get('eu_responsible', {}).get('email') or (manufacturer.get('email') if manufacturer_eu else None)
    if responsible_email:
        attrs['dsa_responsible_party_address'] = responsible_email
    if product.get('model'):
        attrs['model_number'] = product['model']
    ids = product.get('identifiers', {})
    # externally_assigned_product_identifier solo admite type ∈ ean|gtin|upc (PTD real verificada,
    # GPSR-ATRIBUTOS-AMAZON.md §1): manufacturer_ref/sku NO son identificadores externos válidos en
    # Amazon y no se envían por esta vía (sí cuentan como «otro identificador» del art.19.c en la
    # tienda UE). El valor va plano de momento; la forma {type, value} llega al afinar con el PTD
    # real del tipo del producto (pendiente del OK del dueño para descargarlo).
    identifier = ids.get('ean') or ids.get('gtin')
    if identifier:
        attrs['externally_assigned_product_identifier'] = identifier
    if product.get('no_warnings_declaration'):
        attrs['gpsr_safety_attestation'] = True
    else:
        warnings = [{'language_tag': w['lang'], 'value': w['text']}
                    for w in product.get('warnings', []) if not lang or w['lang'] == lang]
        if warnings:
            attrs['safety_warning'] = warnings
    return attrs


def amazon_store_gate(brand_profile, product_profile, *, has_image, has_identifier, store_country):
    """Puerta ÚNICA para publicar en una tienda de Amazon de la UE (apartado 7 de Legal):
    la puerta legal del apartado 5 para esa tienda (vía A) MÁS la confirmación del panel
    «Manage Your Compliance» de la marca (vía B, estado amazon_compliance del perfil de
    marca). Pura. Fuera de la UE no aplica esta puerta. La vía B es PROVISIONAL hasta que
    el hilo Amazon confirme el panel en la ayuda oficial (si la vinculación fuese por
    producto, la confirmación se tomaría del producto en vez de la marca)."""
    brand = validate_brand_gpsr(brand_profile)
    product = validate_product_gpsr(product_profile)
    store = _text(store_country, 2).upper()
    legal = eu_publish_gate(brand_profile, {**(product_profile or {}), 'countries_of_sale': [store]},
                            has_image=has_image, has_identifier=has_identifier)
    missing = list(legal['missing'])
    # Vía B confirmada PARA ESTA TIENDA, a nivel de marca (con Brand Registry) O por SKU (sin Brand Registry).
    confirmed = (brand.get('amazon_compliance', {}).get(store, {}).get('confirmed')
                 or product.get('amazon_compliance', {}).get(store, {}).get('confirmed'))
    if not confirmed:
        missing.append('amazon_compliance_panel')
    return {'store': store, 'blocked': bool(missing), 'missing': missing, 'amazon_compliance_provisional': True}

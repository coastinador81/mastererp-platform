"""Adaptador (STAGED) ficha -> atributos GPSR de Amazon (vía A).

Traduce las formas que captura Frontend (ProductGpsrData en `data.gpsr`; BrandGpsrProfile en
/api/brands) al esquema de product_gpsr.py y produce los ATRIBUTOS reales del PTD de Amazon
(vía A) para una tienda UE. Reutiliza product_gpsr.amazon_attributes (única fuente del mapeo
GPSR->PTD) y resuelve dos detalles de integración:
  - tipo de identificador: identifierType + identifier -> identifiers{tipo: valor};
  - lengua de las advertencias: Frontend usa langTag (p. ej. 'es_ES'); aquí safety_warning se
    construye con el language_tag EXACTO por tienda (lenguas oficiales del país), en vez del
    filtro de 2 letras del módulo puro.

NO cambia comportamiento visible ni publica: solo CONSTRUYE el fragmento GPSR del payload que
el pipeline PTD-driven ya existente (product_requirements / amazon_publish_snapshots) mergea y
valida contra el PTD real. STAGED: hoy no se llama desde ese pipeline; engancharlo es trabajo
de activación (puerta GPSR + OK del dueño).

SEGURIDAD DE JUGUETE (tipo real): `toy_safety` mapea los atributos eu_toys_safety_directive_*
(+ edad) desde una sub-estructura ESTRUCTURADA de la ficha (propuesta: data.gpsr.toySafety).
Amazon confirmó (26-10) que para un SKU AUTÓNOMO (sin variaciones, como el Basic Mini Bricks) el
PTD los EXIGE: NO son opcionales, BLOQUEAN publicar. La CAPTURA de esos valores (qué advertencia/
edad elige el vendedor) se reparte en (a) modelo de datos = este hilo, y (b) UX = Frontend/dueño;
el reparto lo coordina interfaz. Aquí solo se MAPEA lo que la ficha traiga; el enum lo valida el
pipeline PTD-driven contra el esquema vivo (no se duplica la lista de valores aquí).
Formato de `safety_warning.language_tag`: Amazon confirmó `es_ES` (locale con guion bajo); es el
que emite el adaptador (langTag de la ficha).
"""
from . import product_gpsr

# Tipo de responsable: forma de Frontend (brandGpsrProfile.ts) -> esquema de product_gpsr.py.
RESPONSIBLE_TYPE = {'importer': 'importador',
                    'authorized_representative': 'representante_autorizado',
                    'logistics_provider': 'prestador_logistica'}

# Lenguas oficiales por tienda UE (langTag), para elegir la advertencia de cada tienda.
# Mismas que EU_COUNTRIES de pim-gpsr/model/gpsrProfile.ts.
STORE_LANGS = {
    'AT': ('de_AT',), 'BE': ('nl_BE', 'fr_BE', 'de_BE'), 'BG': ('bg_BG',), 'HR': ('hr_HR',),
    'CY': ('el_CY', 'tr_CY'), 'CZ': ('cs_CZ',), 'DK': ('da_DK',), 'EE': ('et_EE',),
    'FI': ('fi_FI', 'sv_FI'), 'FR': ('fr_FR',), 'DE': ('de_DE',), 'GR': ('el_GR',),
    'HU': ('hu_HU',), 'IE': ('en_IE', 'ga_IE'), 'IT': ('it_IT',), 'LV': ('lv_LV',),
    'LT': ('lt_LT',), 'LU': ('fr_LU', 'de_LU', 'lb_LU'), 'MT': ('mt_MT', 'en_MT'),
    'NL': ('nl_NL',), 'PL': ('pl_PL',), 'PT': ('pt_PT',), 'RO': ('ro_RO',), 'SK': ('sk_SK',),
    'SI': ('sl_SI',), 'ES': ('es_ES',), 'SE': ('sv_SE',),
}


def _postal(address):
    a = address or {}
    return {'street': a.get('street', ''), 'postal_code': a.get('postalCode', ''),
            'city': a.get('city', ''), 'country': a.get('country', '')}


def brand_profile(front):
    """BrandGpsrProfile (Frontend) -> brand_profile de product_gpsr.py."""
    front = front or {}
    m = front.get('manufacturer') or {}
    out = {'manufacturer': {'name': m.get('name', ''), 'email': m.get('email', ''),
                            'point_of_contact': m.get('pointOfContact', ''),
                            'postal_address': _postal(m.get('postalAddress'))}}
    r = front.get('euResponsible')
    if r:
        out['eu_responsible'] = {'type': RESPONSIBLE_TYPE.get(r.get('type', ''), r.get('type', '')),
                                 'name': r.get('name', ''), 'email': r.get('email', ''),
                                 'postal_address': _postal(r.get('postalAddress'))}
    return out


def product_profile(front):
    """ProductGpsrData (Frontend) -> product_profile de product_gpsr.py. Las advertencias no se
    incluyen aquí: safety_warning se arma por su language_tag exacto en amazon_gpsr_attributes."""
    front = front or {}
    out = {}
    if front.get('model'):
        out['model'] = front['model']
    itype, ivalue = front.get('identifierType'), front.get('identifier')
    if itype and ivalue:
        out['identifiers'] = {itype: ivalue}
    if front.get('saleCountries'):
        out['countries_of_sale'] = list(front['saleCountries'])
    if front.get('noWarningsNeeded'):
        out['no_warnings_declaration'] = True
    if front.get('sellerDeclaration'):
        # at/by reales los aporta la persistencia al guardar; irrelevantes para la vía A.
        out['seller_declaration'] = {'accepted': True, 'at': '', 'by': ''}
    return out


def _safety_warning(front, store):
    """safety_warning de una tienda: advertencias cuya lengua coincide con las oficiales de esa
    tienda, con el language_tag EXACTO de la ficha (p. ej. 'es_ES'). No inventa texto."""
    if front.get('noWarningsNeeded'):
        return []
    accepted = set(STORE_LANGS.get((store or '').upper(), ()))
    warnings = []
    for entry in front.get('warnings') or []:
        lang, text = entry.get('language', ''), (entry.get('text') or '').strip()
        if text and lang in accepted:
            warnings.append({'language_tag': lang, 'value': text})
    return warnings


def amazon_gpsr_attributes(brand_front, product_front, store_country):
    """Fragmento GPSR (vía A) del payload de Amazon para una tienda UE, con nombres reales del
    PTD. Reutiliza product_gpsr.amazon_attributes para los campos no-advertencia y añade
    safety_warning con el language_tag exacto por tienda. Puro; no publica.

    Incluye la seguridad de juguete (eu_toys_safety_directive_* + edad) si la ficha trae la
    sub-estructura estructurada (ver `toy_safety`)."""
    store = (store_country or '').upper()
    attrs = product_gpsr.amazon_attributes(brand_profile(brand_front), product_profile(product_front), store)
    attrs.pop('safety_warning', None)  # se re-arma con el language_tag exacto por tienda
    warnings = _safety_warning(product_front or {}, store)
    if warnings:
        attrs['safety_warning'] = warnings
    attrs.update(toy_safety(product_front))
    return attrs


def toy_safety(product_front):
    """Mapea la seguridad de juguete ESTRUCTURADA de la ficha (propuesta: data.gpsr.toySafety) a
    los atributos del PTD real TOY_BUILDING_BLOCK. No valida el enum aquí: lo valida el pipeline
    PTD-driven contra el esquema vivo (así no se duplica ni se desactualiza la lista de valores).
    No inventa: solo mapea los valores que el vendedor declaró; si la ficha no los trae, {}.

    Forma de entrada PROPUESTA (parte (a) del reparto; a confirmar con Frontend/interfaz):
        toySafety: {
            warnings: str[],            -> eu_toys_safety_directive_warning
            ageWarning: str,            -> eu_toys_safety_directive_age_warning
            language: str,              -> eu_toys_safety_directive_language
            ageRangeDescription: str,   -> age_range_description
            minAge: int|'' ,            -> manufacturer_minimum_age
            maxAge: int|'' ,            -> manufacturer_maximum_age
            recommendedAge?: str,       -> compliance_recommended_age (único realmente opcional)
        }
    Para un SKU AUTÓNOMO el PTD exige los primeros (bloquean la publicación); la PUERTA los
    comprueba (no este adaptador, que solo construye el payload)."""
    toy = (product_front or {}).get('toySafety') or {}
    attrs = {}
    if toy.get('warnings'):
        attrs['eu_toys_safety_directive_warning'] = [{'value': value} for value in toy['warnings']]
    if toy.get('ageWarning'):
        attrs['eu_toys_safety_directive_age_warning'] = [{'value': toy['ageWarning']}]
    if toy.get('language'):
        attrs['eu_toys_safety_directive_language'] = [{'value': toy['language']}]
    if toy.get('ageRangeDescription'):
        attrs['age_range_description'] = [{'value': toy['ageRangeDescription']}]
    for key, attribute in (('minAge', 'manufacturer_minimum_age'), ('maxAge', 'manufacturer_maximum_age')):
        if toy.get(key) not in (None, ''):
            attrs[attribute] = [{'value': toy[key]}]
    if toy.get('recommendedAge'):
        attrs['compliance_recommended_age'] = [{'value': toy['recommendedAge']}]
    return attrs

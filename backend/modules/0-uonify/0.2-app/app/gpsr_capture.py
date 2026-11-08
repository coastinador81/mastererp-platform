"""Validación en SERVIDOR de la captura GPSR en la forma camelCase del frontend.

ProductGpsrData se guarda en `data.gpsr` (/api/products); BrandGpsrProfile en /api/brands. Esa
forma camelCase es el CONTRATO de /api (gpsrProfile.ts / brandGpsrProfile.ts): se GUARDA tal cual.
La traducción a la forma canónica snake de product_gpsr.py la hace amazon_gpsr_adapter al computar
el GPSR o la puerta. Aquí solo se valida FORMA/formato: no los obligatorios para publicar (eso es
la puerta) ni los enums (los valida el pipeline PTD-driven contra el esquema vivo).
"""
import json

MAX_BYTES = 60000
_ID_TYPES = {'ean', 'gtin', 'manufacturer_ref', 'sku'}
_REGISTRY = {'yes', 'no', 'unknown'}
_RESPONSIBLE = {'importer', 'authorized_representative', 'logistics_provider'}
_PRODUCT_KEYS = {'brand', 'model', 'identifierType', 'identifier', 'hasImage', 'saleCountries',
                 'warnings', 'noWarningsNeeded', 'ownLegislationNotice', 'sellerDeclaration',
                 'brandRegistry', 'amazonCompliance', 'toySafety'}
_TOY_KEYS = {'warnings', 'ageWarning', 'language', 'ageRangeDescription', 'minAge', 'maxAge', 'recommendedAge'}
_BRAND_KEYS = {'brand', 'manufacturer', 'euResponsible', 'autoApply'}
_PARTY_KEYS = {'name', 'postalAddress', 'email', 'pointOfContact'}
_ADDRESS_KEYS = {'street', 'postalCode', 'city', 'country'}


def _fail(message):
    raise ValueError(message)


def _text(value, limit=2000):
    if not isinstance(value, str) or len(value) > limit or '\x00' in value:
        _fail('Dato GPSR de texto no válido.')
    return value


def _boolean(value):
    if not isinstance(value, bool):
        _fail('Dato GPSR booleano no válido.')
    return value


def _size(value):
    if len(json.dumps(value, ensure_ascii=False).encode('utf-8')) > MAX_BYTES:
        _fail('Los datos GPSR superan el tamaño permitido.')


def _address(value):
    if not isinstance(value, dict) or set(value) - _ADDRESS_KEYS:
        _fail('Dirección GPSR no válida.')
    for key in value:
        _text(value[key], 200)


def _party(value):
    if not isinstance(value, dict) or set(value) - _PARTY_KEYS:
        _fail('Revisa el fabricante o la persona responsable.')
    for key in ('name', 'email', 'pointOfContact'):
        if key in value:
            _text(value[key])
    if 'postalAddress' in value:
        _address(value['postalAddress'])


def _warnings(value):
    if not isinstance(value, list) or len(value) > 60:
        _fail('Revisa las advertencias de seguridad.')
    for entry in value:
        if not isinstance(entry, dict) or set(entry) - {'language', 'text', 'aiProposed'}:
            _fail('Revisa una advertencia de seguridad.')
        _text(entry.get('language', ''), 16)
        _text(entry.get('text', ''), 4000)
        if 'aiProposed' in entry:
            _boolean(entry['aiProposed'])


def _toy_safety(value):
    if not isinstance(value, dict) or set(value) - _TOY_KEYS:
        _fail('Revisa la seguridad de juguete.')
    if 'warnings' in value:
        if not isinstance(value['warnings'], list) or len(value['warnings']) > 45:
            _fail('Revisa las advertencias de juguete.')
        for warning in value['warnings']:
            _text(warning, 80)
    for key in ('ageWarning', 'language', 'ageRangeDescription', 'recommendedAge'):
        if value.get(key) not in (None, ''):
            _text(value[key], 200)
    for key in ('minAge', 'maxAge'):
        if value.get(key) not in (None, ''):
            if not isinstance(value[key], int) or isinstance(value[key], bool) or not 0 <= value[key] <= 1200:
                _fail('La edad de la seguridad de juguete no es válida.')


def validate_product_gpsr_capture(value):
    """Valida la forma camelCase del GPSR de producto (ProductGpsrData). Devuelve el valor tal
    cual (se guarda en camelCase). Rechaza claves desconocidas y tipos no válidos."""
    if value in (None, {}):
        return {}
    if not isinstance(value, dict) or set(value) - _PRODUCT_KEYS:
        _fail('Revisa los datos GPSR del producto.')
    _size(value)
    for key in ('brand', 'model', 'identifier', 'ownLegislationNotice'):
        if key in value:
            _text(value[key])
    if 'identifierType' in value and value['identifierType'] not in _ID_TYPES:
        _fail('El tipo de identificador no es válido.')
    if 'brandRegistry' in value and value['brandRegistry'] not in _REGISTRY:
        _fail('El estado de Brand Registry no es válido.')
    for key in ('hasImage', 'noWarningsNeeded', 'sellerDeclaration'):
        if key in value:
            _boolean(value[key])
    if 'saleCountries' in value:
        if not isinstance(value['saleCountries'], list) or len(value['saleCountries']) > 27:
            _fail('Revisa los países de venta.')
        for country in value['saleCountries']:
            _text(country, 2)
    if 'warnings' in value:
        _warnings(value['warnings'])
    if 'toySafety' in value:
        _toy_safety(value['toySafety'])
    if 'amazonCompliance' in value and not isinstance(value['amazonCompliance'], dict):
        _fail('Revisa la confirmación de Amazon.')
    return value


def validate_brand_gpsr_capture(value):
    """Valida la forma camelCase del perfil GPSR de marca (BrandGpsrProfile). Devuelve el valor
    tal cual. `euResponsible` puede ser None (solo hace falta si el fabricante está fuera de la UE)."""
    if value in (None, {}):
        return {}
    if not isinstance(value, dict) or set(value) - _BRAND_KEYS:
        _fail('Revisa el perfil GPSR de la marca.')
    _size(value)
    if 'brand' in value:
        _text(value['brand'], 200)
    if 'autoApply' in value:
        _boolean(value['autoApply'])
    if 'manufacturer' in value:
        _party(value['manufacturer'])
    if value.get('euResponsible') is not None:
        responsible = value['euResponsible']
        if not isinstance(responsible, dict) or set(responsible) - (_PARTY_KEYS | {'type'}):
            _fail('Revisa la persona responsable en la UE.')
        if 'type' in responsible and responsible['type'] not in _RESPONSIBLE:
            _fail('El tipo de persona responsable no es válido.')
        _party({key: val for key, val in responsible.items() if key != 'type'})
    return value

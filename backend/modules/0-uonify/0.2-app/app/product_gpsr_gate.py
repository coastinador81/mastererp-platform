"""Puerta GPSR cableada al flujo de ficha (estado informativo, enforce=False).

COMPUTA el estado de la puerta («falta/lista») de un producto combinando el perfil GPSR de MARCA
heredado (tabla brand_gpsr) y el GPSR del PRODUCTO (data.gpsr). Reutiliza las funciones PURAS de
product_gpsr.py; la traducción de la forma camelCase del frontend a la forma canónica snake la
hace amazon_gpsr_adapter.

enforce=False (hoy, por D-UX-OWNER-DEFINES): la puerta solo se EXPONE (GET
/api/products/{sku}/gpsr-gate) para mostrar «qué falta»; NO bloquea guardar ni publicar. Activar
el bloqueo (enforce) y QUÉ/CUÁNDO se muestra lo decide el dueño.

REQUISITO DE TIPO JUGUETE (Amazon, confirmado 26-10): para un SKU AUTÓNOMO la seguridad de
juguete (eu_toys_safety_directive_*, edad) es REQUERIDA y BLOQUEA publicar; eso es la puerta de
Amazon por tipo (no el art. 19 de eu_publish_gate) y se exige al activar enforce para Amazon.
Aquí se expone el estado de la UE (eu_publish_gate); la parte de Amazon/tipo se añade con enforce.
"""
from . import product_gpsr
from . import amazon_gpsr_adapter
from . import brand_gpsr_store


def load_brand_gpsr(connection, user, brand):
    """Perfil GPSR activo de la marca (forma camelCase guardada), o {}. Usa brand_gpsr_store."""
    row = brand_gpsr_store.find_active(connection, user, brand or '')
    return row['data'] if row else {}


def _gate_product(product_gpsr_cc, user):
    """Convierte el GPSR de producto camelCase (data.gpsr) a la forma snake de la puerta UE.
    Reutiliza amazon_gpsr_adapter.product_profile y añade: las advertencias con lengua de 2
    letras (la ficha usa langTag «es_ES»; eu_publish_gate compara por lengua de país), y la
    declaración del vendedor con fecha/usuario (la ficha solo trae el booleano; enforce=False)."""
    product_gpsr_cc = product_gpsr_cc or {}
    product = dict(amazon_gpsr_adapter.product_profile(product_gpsr_cc))
    warnings = []
    for entry in product_gpsr_cc.get('warnings') or []:
        lang = (entry.get('language') or '').split('_')[0].lower()
        text = (entry.get('text') or '').strip()
        if lang and text:
            warnings.append({'lang': lang, 'text': text})
    if warnings:
        product['warnings'] = warnings
    if product_gpsr_cc.get('sellerDeclaration'):
        product['seller_declaration'] = {'accepted': True, 'at': 'ui', 'by': str(user.get('id', ''))}
    else:
        product.pop('seller_declaration', None)
    return product


def compute_gate(brand_profile, product_profile, *, has_image, has_identifier, stores=()):
    """PURO. Estado de las puertas GPSR reutilizando product_gpsr.py (recibe ya la forma snake).
    `stores`: tiendas ISO2 para la puerta de Amazon (vacío = solo la UE)."""
    eu = product_gpsr.eu_publish_gate(brand_profile, product_profile,
                                      has_image=has_image, has_identifier=has_identifier)
    amazon = {}
    for store in stores:
        amazon[store] = product_gpsr.amazon_store_gate(
            brand_profile, product_profile,
            has_image=has_image, has_identifier=has_identifier, store_country=store)
    return {'eu': eu, 'amazon': amazon}


def evaluate(connection, user, ficha_data, *, stores=(), enforce=False):
    """Estado de la puerta GPSR de un producto (informativo). Carga la marca heredada
    (brand_gpsr_store), traduce marca y producto a la forma snake y computa. enforce=False: solo
    informa, NUNCA bloquea. Devuelve {'eu': {...}, 'amazon': {tienda: {...}}}."""
    ficha = ficha_data if isinstance(ficha_data, dict) else {}
    brand_cc = load_brand_gpsr(connection, user, ficha.get('brand', ''))
    product_cc = ficha.get('gpsr') or {}
    brand = amazon_gpsr_adapter.brand_profile(brand_cc)
    product = _gate_product(product_cc, user)
    return compute_gate(brand, product,
                        has_image=bool(product_cc.get('hasImage')),
                        has_identifier=bool(product.get('identifiers')), stores=stores)

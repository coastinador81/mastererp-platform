"""Mapeo conservador: ficha propia y atributos Amazon conservan otros mercados e idiomas."""
from copy import deepcopy

MAPPING = {'name': 'item_name', 'brand': 'brand', 'description': 'product_description',
           'bullets': 'bullet_point', 'keywords': 'generic_keyword'}
LANGUAGES = {'A1RKKUPIHCS9HS': 'es_ES', 'A1F83G8C2ARO7P': 'en_GB', 'A13V1IB3VIYZZH': 'fr_FR',
             'A1PA6795UKMFR9': 'de_DE', 'APJ6JRA9NG5V4': 'it_IT', 'A1805IZSGTT6HS': 'nl_NL',
             'A2NODRKZP88ZB9': 'sv_SE', 'A1C3SOZRARQ6R3': 'pl_PL', 'AMEN7PMS3EDWL': 'nl_BE', 'A28R8C7NBKEWEA': 'en_IE'}


def matches(item, market):
    return isinstance(item, dict) and item.get('marketplace_id') in (None, market) and item.get('language_tag') in (None, LANGUAGES[market])


def scope_attributes(attributes, market):
    scoped = {}
    for name, value in attributes.items():
        if isinstance(value, list):
            own = [deepcopy(item) for item in value if not isinstance(item, dict) or matches(item, market)]
            if own or not value: scoped[name] = own
        else:
            scoped[name] = deepcopy(value)
    return scoped


def merge_scope(attributes, replacements, market):
    result = deepcopy(attributes)
    for name, value in replacements.items():
        before = result.get(name, [])
        foreign = [item for item in before if isinstance(item, dict) and not matches(item, market)] if isinstance(before, list) else []
        result[name] = foreign + value if isinstance(value, list) else value
    return result


def to_amazon(product, schema, attributes, market, changed=None):
    result = deepcopy(attributes)
    for local, remote in MAPPING.items():
        if changed is not None and local not in changed or remote not in schema.get('properties', {}):
            continue
        if local not in product:
            continue
        values = product[local] if local == 'bullets' else [product[local]]
        values = [value for value in values if isinstance(value, str) and value.strip()]
        existing = result.get(remote, [])
        if not isinstance(existing, list):
            existing = []
        own = [item for item in existing if matches(item, market)]
        other = [item for item in existing if not matches(item, market)]
        items = []
        for index, value in enumerate(values):
            item = deepcopy(own[index]) if index < len(own) else {}
            item.update(value=value, marketplace_id=market, language_tag=LANGUAGES[market])
            items.append(item)
        if other or items:
            result[remote] = [*other, *items]
        else:
            result.pop(remote, None)
    return result


def from_amazon(product, attributes, market, changed):
    patch = {}
    for local, remote in MAPPING.items():
        if remote not in changed:
            continue
        values = [item.get('value') for item in attributes.get(remote, []) if matches(item, market)]
        values = [value for value in values if isinstance(value, str)]
        if not values:
            continue
        if local == 'bullets':
            # La ficha permite seis; los restantes se conservan íntegros en amazonAttributes.
            if len(values) <= 6 and all(len(value) <= 2000 for value in values):
                patch[local] = values
        elif len(values[0]) <= {'name': 500, 'brand': 200, 'description': 20000, 'keywords': 2000}[local]:
            patch[local] = values[0]
    return patch


def sync_manual(connection, user, current, content, changed):
    context = content.get('amazonRequirementsContext')
    if not current or not context or not set(changed).intersection(MAPPING):
        return content
    row = connection.execute('''SELECT schema FROM product_requirement_schemas WHERE user_id=%s AND product_id=%s
        AND seller_id=%s AND marketplace_id=%s''',
        (user['id'], current['id'], context['sellerId'], context['marketplaceId'])).fetchone()
    if row:
        content['amazonAttributes'] = to_amazon(content, row['schema'], content.get('amazonAttributes', {}), context['marketplaceId'], changed)
    return content

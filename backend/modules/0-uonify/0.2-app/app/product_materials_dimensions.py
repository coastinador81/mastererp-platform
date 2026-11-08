"""Explicit dimensions of the complete product or package; components stay separate."""
import re
from .product_requirements_suggestions import named_unit, normalized

AXES = {'length': {'largo', 'longitud', 'length'}, 'width': {'ancho', 'anchura', 'width'},
        'height': {'alto', 'altura', 'height'}, 'depth': {'profundidad', 'depth'}}
SCOPES = {
    'product': {'producto', 'producto completo', 'producto completo torre montada', 'complete product', 'whole product'},
    'package': {'caja cerrada', 'paquete', 'embalaje', 'package', 'closed box'},
}


def dimension_key(name):
    """No inferir que una pieza, una base o una torre sin contexto es el producto vendido."""
    text = normalized(named_unit(name)[0])
    for scope, labels in SCOPES.items():
        for axis, aliases in AXES.items():
            for label in labels:
                if any(text in (f'{label} {alias}', f'{alias} {label}', f'{alias} del {label}',
                                f'{alias} de la {label}') for alias in aliases):
                    return scope, axis
    # A qualifier in parentheses is allowed only after the explicit complete-product marker.
    match = re.fullmatch(r'producto completo (?:[a-z0-9 ]+ )?(largo|longitud|ancho|anchura|alto|altura|profundidad)', text)
    if match:
        return 'product', next(axis for axis, aliases in AXES.items() if match[1] in aliases)
    return None


def matches_dimension(item, attribute, path):
    key = dimension_key(str(item.get('name', '')))
    return bool(key and key == ('package' if attribute == 'item_package_dimensions' else 'product', path[2]))

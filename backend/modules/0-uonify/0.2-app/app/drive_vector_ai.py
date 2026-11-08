"""Lectura declarativa AI5: trazados y capas, nunca ejecución de PostScript.

Subconjunto explícito del formato Adobe Illustrator 7 (capítulos 5 y 9).
Un operador desconocido produce incidencia; no se sustituye por otra imagen.
"""
from html import escape
import json
import math
import re
from .drive_extract import ExtractionError

NUMBER = r'[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?'


def legacy_ai_svg(content):
    if len(content) > 4 * 1024 * 1024:
        raise ExtractionError('El AI legacy supera 4 MiB; exporta una copia PDF autónoma.')
    text = content.decode('latin1').replace('\r\n', '\n').replace('\r', '\n')
    bbox = re.search(r'^%%BoundingBox:\s*(' + NUMBER + r')\s+(' + NUMBER + r')\s+(' + NUMBER + r')\s+(' + NUMBER + r')\s*$', text, re.M)
    if not text.startswith('%!PS-Adobe') or '%AI5_FileFormat' not in text or not bbox:
        raise ExtractionError('AI legacy sin formato o límites reconocibles; exporta PDF compatible.')
    bounds = [float(value) for value in bbox.groups()]
    x0, y0, x1, y1 = bounds
    if not all(math.isfinite(v) and abs(v) <= 1000000 for v in bounds) or not 0 < x1-x0 <= 20000 or not 0 < y1-y0 <= 20000:
        raise ExtractionError('El AI tiene dimensiones fuera del límite seguro.')
    try:
        prolog, setup = text.split('%%BeginProlog', 1)[1].split('%%EndProlog', 1)
        setup, body = setup.split('%%BeginSetup', 1)[1].split('%%EndSetup', 1)
        body, trailer = body.split('%%PageTrailer', 1)
    except (ValueError, IndexError) as error:
        raise ExtractionError('La estructura AI legacy requiere una exportación PDF compatible.') from error
    if any(line.strip() and not line.lstrip().startswith('%') for line in prolog.splitlines()):
        raise ExtractionError('El AI usa un prólogo personalizado no admitido; exporta PDF autónomo.')
    for section, action in ((setup, 'initialize'), (trailer, 'terminate')):
        for line in section.splitlines():
            line = line.strip()
            if not line or line.startswith('%') or line == 'gsave annotatepage grestore showpage':
                continue
            if not re.fullmatch(r'Adobe_[\w]+ /' + action + r' get exec', line):
                raise ExtractionError('El AI contiene operaciones fuera del subconjunto seguro; exporta PDF.')
    layers, paths, objects = [], [], []
    layer, path, stroke, fill = None, [], 'rgb(0,0,0)', 'rgb(0,0,0)'
    width, cap, join, groups = 1.0, 0, 0, 0
    count = 0
    operators = {'m': 2, 'l': 2, 'L': 2, 'c': 6, 'C': 6, 'w': 1, 'J': 1, 'j': 1,
                 'g': 1, 'G': 1, 'Xa': 3, 'XA': 3, 'Lb': 10, 'LB': 0, 'u': 0, 'U': 0,
                 'f': 0, 'F': 0, 's': 0, 'S': 0, 'n': 0, 'N': 0}
    for line_number, line in enumerate(body.splitlines(), 1):
        line = line.strip()
        if not line or line in ('%AI5_BeginLayer', '%AI5_EndLayer--'):
            continue
        count += 1
        if count > 50000:
            raise ExtractionError('El AI supera 50.000 operaciones de trazado.')
        name = re.fullmatch(r'\(((?:[^()\\]|\\[()\\])*)\)\s+Ln', line)
        if name:
            if layer is None:
                raise ExtractionError('El AI contiene un nombre de capa sin capa.')
            layer['name'] = re.sub(r'\\([()\\])', r'\1', name[1])
            continue
        pieces = line.split()
        operation = pieces[-1]
        if operation not in operators or len(pieces) - 1 != operators[operation] or any(not re.fullmatch(NUMBER, p) for p in pieces[:-1]):
            raise ExtractionError(f'AI legacy: operación no admitida en línea {line_number}; exporta PDF compatible.')
        values = [float(p) for p in pieces[:-1]]
        if not all(math.isfinite(v) and abs(v) <= 1000000 for v in values):
            raise ExtractionError('El AI tiene coordenadas no válidas.')
        if operation == 'Lb':
            if layer is not None or path or groups or any(v not in (0, 1) for v in values[:6]) or values[5]:
                raise ExtractionError('Las capas AI usan una estructura o máscara no admitida.')
            layer = {'name': '', 'visible': bool(values[0]), 'printing': bool(values[3]), 'paths': 0}
            layers.append(layer)
        elif operation == 'LB':
            if layer is None or path or groups:
                raise ExtractionError('El AI tiene una capa incompleta.')
            layer = None
        elif operation in ('u', 'U'):
            groups += 1 if operation == 'u' else -1
            if groups < 0 or groups > 100:
                raise ExtractionError('Los grupos AI no están equilibrados.')
        elif operation in ('m', 'l', 'L', 'c', 'C'):
            if layer is None or (not path and operation != 'm'):
                raise ExtractionError('El AI tiene un trazado incompleto.')
            path.append(('M' if operation == 'm' else 'L' if operation in ('l', 'L') else 'C') + ' '.join(f'{v:g}' for v in values))
        elif operation in ('g', 'G', 'Xa', 'XA'):
            if any(v < 0 or v > 1 for v in values):
                raise ExtractionError('El AI tiene un color fuera de rango.')
            rgb = values * 3 if len(values) == 1 else values
            color = 'rgb(' + ','.join(f'{v * 255:g}' for v in rgb) + ')'
            if operation in ('g', 'Xa'):
                fill = color
            else:
                stroke = color
        elif operation in ('w', 'J', 'j'):
            if operation == 'w':
                width = values[0]
                if not 0 <= width <= 10000:
                    raise ExtractionError('El AI tiene grosor fuera del límite.')
            elif values[0] not in (0, 1, 2):
                raise ExtractionError('El AI tiene un remate no admitido.')
            elif operation == 'J':
                cap = int(values[0])
            else:
                join = int(values[0])
        else:
            if layer is None or not path:
                raise ExtractionError('El AI termina un trazado inexistente.')
            closed = operation in ('f', 's', 'N')
            data = ' '.join(path) + (' Z' if closed else '')
            visible = layer['visible'] and operation not in ('n', 'N')
            objects.append({'layer': layer['name'], 'visible': visible, 'operation': operation,
                            'path': data, 'fill': fill, 'stroke': stroke, 'strokeWidth': width})
            if visible:
                color_fill = fill if operation in ('f', 'F') else 'none'
                color_stroke = stroke if operation in ('s', 'S') else 'none'
                paths.append(f'<path d="{escape(data, quote=True)}" fill="{color_fill}" stroke="{color_stroke}" stroke-width="{width:g}" stroke-linecap="{("butt","round","square")[cap]}" stroke-linejoin="{("miter","round","bevel")[join]}"/>')
            layer['paths'] += 1
            path = []
    if layer is not None or path or groups or not objects:
        raise ExtractionError('El AI no contiene una composición completa de trazados.')
    svg = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {x1-x0:g} {y1-y0:g}"><g transform="translate({-x0:g},{y1:g}) scale(1,-1)">' + ''.join(paths) + '</g></svg>'
    metadata = {'method': 'ai5_declarative_paths_v1', 'boundingBoxPoints': bounds, 'layers': layers,
                'pathCount': len(objects), 'visiblePathCount': sum(obj['visible'] for obj in objects),
                'operations': count, 'hiddenGeometryPreserved': True, 'postscriptExecuted': False}
    units = [('AI · Capas y trazados', json.dumps({'layers': layers, 'objects': objects}, ensure_ascii=False))]
    return svg.encode(), units, metadata

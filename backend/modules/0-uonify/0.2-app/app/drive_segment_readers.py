"""Lectura secuencial de páginas/celdas/secciones; ningún límite se presenta como éxito."""
import csv
import io
import json
import math
import re
from itertools import zip_longest
from pypdf import PdfReader
from openpyxl import load_workbook
from defusedxml.ElementTree import fromstring
from .drive_extract import ExtractionError, XLSX, DOCX, TEXT_MIMES, safe_archive

# Límite del parser CSV global coherente con el tamaño máximo admitido de una fuente.
csv.field_size_limit(64 * 1024 * 1024)


def read_pdf(content, coverage, warnings):
    reader = PdfReader(io.BytesIO(content), strict=False)
    if reader.is_encrypted:
        raise ExtractionError('El PDF está cifrado. Proporciona una copia sin contraseña.')
    coverage.update({'pages': len(reader.pages), 'emptyPages': [], 'visualReviewPages': []})
    for index, page in enumerate(reader.pages):
        stream = page.get_contents()
        if stream is not None and len(stream.get_data()) > 8 * 1024 * 1024:
            raise ExtractionError(f'La página {index + 1} supera 8 MiB de contenido PDF descomprimido; '
                                  'requiere una copia optimizada para lectura segura.')
        text = page.extract_text() or ''
        if not text.strip():
            coverage['emptyPages'].append(index + 1)
            if stream is not None and stream.get_data().strip():
                coverage['visualReviewPages'].append(index + 1)
        yield f'Página {index + 1}', text
    if coverage['visualReviewPages']:
        coverage['complete'] = False
        warnings.append(f"PDF: {len(coverage['visualReviewPages'])} páginas sin texto extraíble requieren "
                        'lectura visual u OCR; permanecen pendientes y no se consideran analizadas.')
    if coverage['pages'] == len(coverage['emptyPages']):
        coverage['complete'] = False
        warnings.append('El PDF no contiene texto extraíble. Las páginas vacías o escaneadas quedan registradas.')


def read_xlsx(content, coverage, warnings):
    with safe_archive(content) as archive:
        embedded = any(item.startswith(('xl/media/', 'xl/charts/')) for item in archive.namelist())
        values = load_workbook(io.BytesIO(content), read_only=True, data_only=True, keep_links=False)
        formulas = load_workbook(io.BytesIO(content), read_only=True, data_only=False, keep_links=False)
        coverage.update({'sheets': len(values.worksheets), 'rows': 0, 'cells': 0, 'formulaCells': 0,
                         'missingFormulaValues': 0, 'invalidFormulaValues': 0, 'uncertainFormulaValues': 0, 'formulaEvidence': [], 'sheetCoverage': []})
        try:
            for sheet, formula_sheet in zip(values.worksheets, formulas.worksheets):
                # Algunas aplicaciones guardan dimensiones incorrectas. Se recorre el XML real.
                sheet.reset_dimensions()
                formula_sheet.reset_dimensions()
                stats = {'name': sheet.title, 'rows': 0, 'columns': 0, 'cells': 0}
                headers = {}
                rows = zip_longest(sheet.iter_rows(), formula_sheet.iter_rows(), fillvalue=())
                for row_index, (row, formula_row) in enumerate(rows, 1):
                    stats['rows'] += 1
                    stats['columns'] = max(stats['columns'], len(row), len(formula_row))
                    cells = []
                    for column, (cell, formula) in enumerate(zip_longest(row, formula_row), 1):
                        value = getattr(cell, 'value', None)
                        coordinate = getattr(formula, 'coordinate', None) or getattr(cell, 'coordinate', '')
                        if getattr(formula, 'data_type', None) == 'f':
                            coverage['formulaCells'] += 1
                            cached_type = type(value).__name__
                            cached = value if value is None or isinstance(value, (str, int, float, bool)) else (value.isoformat() if hasattr(value, 'isoformat') else str(value))
                            nonfinite = isinstance(cached, float) and not math.isfinite(cached)
                            if nonfinite:
                                cached = str(cached)
                            expression = str(getattr(formula.value, 'text', formula.value))
                            if value is None:
                                coverage['missingFormulaValues'] += 1
                                status = 'missing'
                                value = '[Fórmula sin valor guardado; pendiente de cálculo en la fuente]'
                            elif getattr(cell, 'data_type', None) == 'e' or nonfinite:
                                coverage['invalidFormulaValues'] += 1
                                status = 'cached_error'
                            else:
                                coverage['uncertainFormulaValues'] += 1
                                status = 'cached_unverified'
                            coverage['formulaEvidence'].append({'locator': f'{sheet.title}!{coordinate}',
                                'rowLocator': f'{sheet.title}!fila {row_index}', 'method': 'formula',
                                'formula': expression, 'cachedValue': cached, 'cachedType': cached_type, 'cacheStatus': status,
                                'freshness': 'unknown', 'executed': False})
                            value = f'{value} [fórmula: {expression}; caché: {status}; no recalculada]'

                        if value is None:
                            continue
                        stats['cells'] += 1
                        label = ''.join(char for char in coordinate if char.isalpha()) or str(column)
                        if row_index == 1 and isinstance(value, str) and len(value) <= 120:
                            headers[column] = value
                        header = f' ({headers[column]})' if row_index > 1 and column in headers else ''
                        cells.append(f'{label}{header}: {value}')
                    yield f'{sheet.title}!fila {row_index}', ' | '.join(cells)
                coverage['rows'] += stats['rows']
                coverage['cells'] += stats['cells']
                coverage['sheetCoverage'].append(stats)
        finally:
            values.close()
            formulas.close()
        warnings.append('Excel: se leen todos los valores guardados; las fórmulas no se ejecutan ni se recalculan.')
        if coverage['missingFormulaValues']:
            coverage['complete'] = False
            warnings.append(f"Excel: {coverage['missingFormulaValues']} fórmulas carecen de valor guardado. "
                            'Recalcula y guarda la fuente para completar esos datos.')
        if coverage['invalidFormulaValues']:
            coverage['complete'] = False
            warnings.append('Excel: hay fórmulas cuyo valor guardado es un error; corrige y guarda la fuente.')
        if coverage['uncertainFormulaValues']:
            warnings.append('Excel: la antigüedad de los valores de fórmula guardados no se puede verificar; requieren confirmación.')
        executable = [name for name in archive.namelist() if name.endswith('vbaProject.bin') or '/queryTables/' in name or name == 'xl/connections.xml']
        coverage['externalOrExecutablePartsNotExecuted'] = executable
        if executable:
            warnings.append('Excel: macros, consultas o conexiones detectadas se conservan sin ejecutar ni actualizar.')
        if embedded:
            warnings.append('Excel contiene imágenes o gráficos incrustados; su inspección visual queda pendiente.')
            coverage['embeddedVisualsPending'] = True


def read_docx(content, coverage, warnings):
    namespace = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
    with safe_archive(content) as archive:
        names = archive.namelist()
        stories = sorted(name for name in names if name.startswith('word/') and name.endswith('.xml')
                         and (name == 'word/document.xml' or name.startswith(('word/header', 'word/footer'))
                              or name in {'word/footnotes.xml', 'word/endnotes.xml', 'word/comments.xml'}))
        if 'word/document.xml' not in stories:
            raise ExtractionError('El documento Word no contiene el cuerpo principal esperado.')
        coverage.update({'paragraphs': 0, 'sections': len(stories)})
        for name in stories:
            root = fromstring(archive.read(name))
            for index, paragraph in enumerate(root.iter(namespace + 'p'), 1):
                coverage['paragraphs'] += 1
                text = ''.join((node.text or '') if node.tag == namespace + 't'
                               else '\t' if node.tag == namespace + 'tab' else '\n'
                               for node in paragraph.iter() if node.tag in {
                                   namespace + 't', namespace + 'tab', namespace + 'br', namespace + 'cr'})
                yield f'{name[5:-4]} · Párrafo {index}', text
        if any(name.startswith('word/media/') for name in names):
            warnings.append('Word contiene imágenes incrustadas; su inspección visual queda pendiente.')
            coverage['embeddedVisualsPending'] = True


def decode_text(content):
    try:
        return content.decode('utf-16' if content.startswith((b'\xff\xfe', b'\xfe\xff')) else 'utf-8-sig')
    except UnicodeDecodeError as error:
        raise ExtractionError('La codificación de texto no es UTF-8 ni UTF-16 con marca. '
                              'Guarda una copia UTF-8 para evitar perder o sustituir caracteres.') from error


def unique_pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ExtractionError('El JSON repite una clave dentro del mismo objeto. Corrige esa ambigüedad antes de analizarlo.')
        result[key] = value
    return result


def read_json(text, coverage):
    try:
        value = json.loads(text, object_pairs_hook=unique_pairs)
    except (ValueError, RecursionError) as error:
        if isinstance(error, ExtractionError):
            raise
        raise ExtractionError('El JSON no es válido o su estructura excede la profundidad segura. '
                              'No se ha marcado como leído.') from error
    stack = [('$', value, 0)]
    coverage['leaves'] = 0
    while stack:
        path, node, depth = stack.pop()
        if depth > 256:
            raise ExtractionError('El JSON supera 256 niveles de estructura; divide la fuente para lectura segura.')
        if isinstance(node, dict) and node:
            stack.extend((path + ('.' + key if re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', key)
                                  else '[' + json.dumps(key, ensure_ascii=False) + ']'), val, depth + 1)
                         for key, val in reversed(list(node.items())))
        elif isinstance(node, list) and node:
            stack.extend((path + '[' + str(index) + ']', node[index], depth + 1)
                         for index in range(len(node) - 1, -1, -1))
        else:
            coverage['leaves'] += 1
            yield path, json.dumps(node, ensure_ascii=False)


def read_csv(text, coverage):
    coverage['rows'] = 0
    headers = []
    try:
        dialect = csv.Sniffer().sniff(text[:8192], delimiters=',;\t|')
    except csv.Error:
        try:
            dialect = csv.Sniffer().sniff(text.splitlines()[0], delimiters=',;\t|')
        except (csv.Error, IndexError):
            dialect = csv.excel
    for index, row in enumerate(csv.reader(io.StringIO(text), dialect=dialect, strict=True), 1):
        coverage['rows'] += 1
        if index == 1:
            headers = [cell if len(cell) <= 120 else '' for cell in row]
        cells = [f'{column + 1}' + (f' ({headers[column]})' if index > 1 and column < len(headers) and headers[column] else '')
                 + ': ' + value for column, value in enumerate(row)]
        yield f'Fila {index}', ' | '.join(cells)


def read_units(content, mime, name, coverage, warnings):
    if mime == 'application/pdf':
        yield from read_pdf(content, coverage, warnings)
    elif mime == XLSX:
        yield from read_xlsx(content, coverage, warnings)
    elif mime == DOCX:
        yield from read_docx(content, coverage, warnings)
    elif mime in TEXT_MIMES:
        text = decode_text(content)
        if mime == 'application/json' or name.lower().endswith('.json'):
            yield from read_json(text, coverage)
        elif mime == 'text/csv':
            yield from read_csv(text, coverage)
        else:
            coverage['lines'] = len(text.splitlines())
            yield from ((f'Línea {index}', line) for index, line in enumerate(text.splitlines(), 1))
    else:
        raise ExtractionError('Este formato se conserva como referencia, pero todavía no se analiza.')

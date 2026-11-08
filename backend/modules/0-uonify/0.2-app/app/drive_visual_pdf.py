"""PDF híbrido: tablas documentales, imágenes y OCR rasterizado sin ejecutar acciones PDF."""
import hashlib
import io
import threading
from .drive_extract import ExtractionError
from .drive_pdf_plan import plan_pages

PDF_LOCK = threading.Lock()  # PDFium no admite llamadas simultáneas entre hilos.


def table_fragments(page, page_number, coverage):
    parts = []
    if len(page.chars) > 200000 or len(page.edges) > 20000:
        raise ExtractionError('La página PDF supera la complejidad segura de tablas; aporta una copia simplificada.')
    tables = page.find_tables()
    for index, table in enumerate(tables, 1):
        rows = table.extract()
        left, top = page.bbox[:2]
        x0, y0, x1, y1 = table.bbox
        coordinates = {'page': page_number, 'bbox': [x0 - left, y0 - top, x1 - left, y1 - top],
                       'width': page.width, 'height': page.height, 'coordinateSpace': 'pdf_points',
                       'origin': 'top-left', 'pageBox': 'media', 'pageBoxBounds': list(page.bbox)}
        locator = f'Página {page_number} · Tabla {index}'
        segments = []
        headers = rows[0] if rows else []
        for row_index, row in enumerate(rows, 1):
            cells = [f'{column + 1}' + (f' ({headers[column]})' if row_index > 1 and column < len(headers) and headers[column] else '')
                     + ': ' + (value or '') for column, value in enumerate(row)]
            if any(value for value in row):
                segments.append({'locator': f'{locator} · fila {row_index}', 'text': ' | '.join(cells),
                                 'method': 'pdf_table', 'region': coordinates})
        coverage.setdefault('tables', []).append({'locator': locator, 'rows': len(rows), 'region': coordinates,
                                                   'status': 'read' if segments else 'visual_review'})
        if segments:
            key = hashlib.sha256(locator.encode()).hexdigest()[:16]
            parts.append({'key': f'table-{key}', 'segments': segments})
    return parts


def pdf_visuals(content, budget, warnings):
    import pdfplumber
    import pypdfium2 as pdfium
    from .drive_visual import inspect_image
    coverage = budget.coverage
    parts = []
    pending = set(coverage.get('visualReviewPages', []))
    with PDF_LOCK, pdfplumber.open(io.BytesIO(content)) as structured, pdfium.PdfDocument(content) as document:
        coverage['pages'] = len(document)
        plans = plan_pages(structured, document, budget, warnings)
        for index, page in enumerate(structured.pages):
            number = index + 1
            parts.extend(table_fragments(page, number, coverage))
            plan = plans[index]
            if not plan:
                coverage['visualUnits'].append({'locator': f'Página {number}', 'page': number,
                                                'status': 'native_text', 'images': 0})
                page.close()
                continue
            native = document[index]
            try:
                width, height, scale = plan['width'], plan['height'], plan['scale']
                bitmap = native.render(scale=scale, may_draw_forms=False)
                try:
                    image = bitmap.to_pil().copy()
                finally:
                    bitmap.close()
                context = {'page': number, 'dpi': round(scale * 72, 2),
                           'pageWidthPoints': width, 'pageHeightPoints': height,
                           'pageBox': 'visible', 'pageBoxPdfBounds': list(native.get_bbox())}
                parts.extend(inspect_image(image, f'Página {number}', budget, context))
                pending.discard(number)
            finally:
                native.close()
                page.close()
    coverage['visualReviewPages'] = sorted(pending)
    # La falta de texto digital se ha leído visualmente; no implica que OCR sea infalible.
    if not pending:
        previous_pdf_pending = any('PDF' in warning and ('OCR' in warning or 'texto extraíble' in warning) for warning in warnings)
        warnings[:] = [warning for warning in warnings if not ('PDF' in warning and ('OCR' in warning or 'texto extraíble' in warning))]
        if previous_pdf_pending:
            coverage['complete'] = True
    if coverage.get('ocr', {}).get('units'):
        warnings.append('PDF: OCR local sobre páginas rasterizadas; el texto reconocido y los símbolos requieren revisión visual.')
    coverage['pdfVisualProfile'] = 'vectors-v1'
    return parts

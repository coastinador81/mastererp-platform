"""Presupuesto PDF determinista; conserva resolución de lecturas existentes al ampliar dibujos."""
import math
from .drive_extract import ExtractionError

MAX_PAGE_PIXELS = 20_000_000
MIN_VECTOR_DPI = 150


def pixels(plan, scale):
    return math.ceil(plan['width'] * scale) * math.ceil(plan['height'] * scale)


def allocate_scales(plans, pixel_budget, unit_budget):
    active = [plan for plan in plans if plan]
    if len(active) > unit_budget:
        raise ExtractionError('El PDF supera el presupuesto de unidades visuales; divide la fuente para continuar.')
    for plan in active:
        plan['scale'] = min(300 / 72, math.sqrt(MAX_PAGE_PIXELS / (plan['width'] * plan['height'])))
        plan['pixels'] = pixels(plan, plan['scale'])
    fixed = sum(plan['pixels'] for plan in active if plan['legacy'])
    if fixed > pixel_budget:
        raise ExtractionError('Las páginas PDF con imágenes, texto pequeño o escaneadas superan el presupuesto visual seguro; divide la fuente.')
    if sum(plan['pixels'] for plan in active) <= pixel_budget:
        return plans
    vectors = [plan for plan in active if not plan['legacy']]
    available = math.floor((pixel_budget - fixed) * .99)  # Reserva para redondeos de rasterización.
    area = sum(plan['width'] * plan['height'] for plan in vectors)
    limit = min(300 / 72, math.sqrt(max(0, available) / area)) if area else 0
    lower, upper = 0.0, limit
    for _ in range(48):
        candidate = (lower + upper) / 2
        total = sum(pixels(plan, min(plan['scale'], candidate)) for plan in vectors)
        if total <= available:
            lower = candidate
        else:
            upper = candidate
    if any(min(plan['scale'], lower) * 72 < MIN_VECTOR_DPI for plan in vectors):
        raise ExtractionError(f'El PDF no cabe en el presupuesto visual manteniendo al menos {MIN_VECTOR_DPI} dpi para sus dibujos; divide la fuente.')
    for plan in vectors:
        plan['scale'] = min(plan['scale'], lower)
        plan['pixels'] = pixels(plan, plan['scale'])
        plan['adaptive'] = True
    return plans


def plan_pages(structured, document, budget, warnings):
    from .drive_visual import MAX_VISUAL_PIXELS, MAX_VISUAL_UNITS
    plans = []
    for index, page in enumerate(structured.pages):
        chars = page.chars
        if len(chars) > 200000 or len(page.edges) > 20000:
            raise ExtractionError('La página PDF supera la complejidad segura de lectura; aporta una copia simplificada.')
        legacy = bool(page.images or not chars or any(0 < float(char.get('size', 12)) < 7 for char in chars))
        drawings = len(page.curves) + len(page.rects) + len(page.lines)
        if legacy or drawings:
            native = document[index]
            try:
                width, height = native.get_size()
            finally:
                native.close()
            if not all(math.isfinite(value) and value > 0 for value in (width, height)):
                raise ExtractionError('La página PDF no tiene dimensiones válidas para lectura segura.')
            plans.append({'width': width, 'height': height, 'legacy': legacy, 'page': index + 1})
        else:
            plans.append(None)
        page.close()
    allocate_scales(plans, MAX_VISUAL_PIXELS - budget.pixels, MAX_VISUAL_UNITS - budget.units)
    active = [plan for plan in plans if plan]
    adapted = [plan for plan in active if plan.get('adaptive')]
    budget.coverage['pdfRasterBudget'] = {
        'pixelLimit': MAX_VISUAL_PIXELS, 'plannedPixels': sum(plan['pixels'] for plan in active),
        'legacyVisualPages': sum(plan['legacy'] for plan in active),
        'vectorOnlyPages': sum(not plan['legacy'] for plan in active),
        'adaptivePages': len(adapted), 'minimumAdaptiveDpi': MIN_VECTOR_DPI,
        'roundingReserve': .01,
    }
    if adapted:
        dpi = sorted({round(plan['scale'] * 72, 2) for plan in adapted})
        warnings.append(f'PDF: {len(adapted)} páginas con dibujos y texto nativo legible se rasterizan a {dpi[0]}–{dpi[-1]} dpi '
                        'dentro del presupuesto visual. Las páginas con imágenes o texto pequeño conservan su resolución; cada región registra sus dpi.')
    return plans

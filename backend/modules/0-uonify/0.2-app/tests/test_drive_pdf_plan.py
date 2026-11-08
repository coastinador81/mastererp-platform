from copy import deepcopy
import math
import pytest
from app.drive_extract import ExtractionError
from app.drive_pdf_plan import allocate_scales


def page(legacy=False, width=595, height=842):
    return {'width': width, 'height': height, 'legacy': legacy}


def test_adaptive_vector_pages_fit_budget_and_preserve_previous_300dpi_rasters():
    original = [page(True) for _ in range(17)] + [page() for _ in range(12)]
    plans = allocate_scales(deepcopy(original), 200_000_000, 256)
    assert plans == allocate_scales(deepcopy(original), 200_000_000, 256)
    assert all(plan['scale'] == 300 / 72 for plan in plans[:17])
    assert all(plan['pixels'] == 2480 * 3509 for plan in plans[:17])
    assert all(210 < plan['scale'] * 72 < 211 for plan in plans[17:])
    assert sum(plan['pixels'] for plan in plans) <= 147_939_440 + math.floor(52_060_560 * .99)


def test_adaptive_budget_counts_ceiled_dimensions_instead_of_fractional_area():
    plans = allocate_scales([page(width=300.25, height=490.75) for _ in range(3)], 3_000_000, 256)
    assert all(plan['pixels'] == math.ceil(plan['width'] * plan['scale']) * math.ceil(plan['height'] * plan['scale']) for plan in plans)
    assert sum(plan['pixels'] for plan in plans) <= 3_000_000 * .99
    assert all(plan['scale'] * 72 >= 150 for plan in plans)


def test_adequate_budget_keeps_all_pages_at_requested_resolution():
    plans = allocate_scales([page(True), None, page()], 200_000_000, 256)
    assert plans[1] is None
    assert plans[0]['scale'] == plans[2]['scale'] == 300 / 72
    assert not any(plan.get('adaptive') for plan in plans if plan)


def test_existing_image_pages_are_never_silently_downsampled_to_fit():
    with pytest.raises(ExtractionError, match='imágenes'):
        allocate_scales([page(True)], 1_000_000, 256)


def test_vector_minimum_resolution_failure_is_explicit():
    with pytest.raises(ExtractionError, match='150 dpi'):
        allocate_scales([page()], 100_000, 256)


def test_page_count_budget_is_enforced_before_any_raster_work():
    with pytest.raises(ExtractionError, match='unidades visuales'):
        allocate_scales([page(), page()], 200_000_000, 1)

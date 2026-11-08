"""Los costes auxiliares se cierran sin consultar ni ejecutar Google/Craft."""

from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest

from app.creative_composite_quote import (CostCeiling, ExecutionBinding,
    RequestOperationBinding, composite_quote_readiness,
    execution_binding_sha256, canonical_json, canonical_sha256)
from app.creative_infrastructure_costs import (InfrastructureRateSnapshot,
    InfrastructureUsageCeiling, infrastructure_cost_ceilings)


NOW = datetime(2026, 10, 18, 18, tzinfo=timezone.utc)
REQUEST = {'endpoint': 'https://europe.example.test/v1/models/video:generate',
           'model': 'video-model', 'body': {'prompt': 'City'},
           'inputManifest': []}
REQUEST_JSON = canonical_json(REQUEST)
REQUEST_SHA = canonical_sha256(REQUEST)


def binding():
    return ExecutionBinding(
        '11111111-1111-4111-8111-111111111111', 3, 'a' * 64,
        'b' * 64, 'c' * 64, 'd' * 64, '2' * 64,
        (RequestOperationBinding('22222222-2222-4222-8222-222222222222',
                                 1, 'shot-01', 'video', REQUEST_SHA,
                                 REQUEST['model'], REQUEST['endpoint'], REQUEST_JSON),),
        'filmcraft', '0.9.0', 'video_export', '1' * 64)


def rates(**changes):
    values = dict(
        location='europe-west1', storage_gib_month_usd=Decimal('0.02'),
        class_a_per_1000_usd=Decimal('0.005'),
        class_b_per_1000_usd=Decimal('0.0004'),
        transfer_gib_usd=Decimal('0.02'),
        transcoder_hd_minute_usd=Decimal('0.03'),
        storage_evidence_sha256='a' * 64,
        transcoder_evidence_sha256='b' * 64,
        craft_evidence_sha256='c' * 64,
        checked_at=NOW - timedelta(hours=1),
        expires_at=NOW + timedelta(hours=1))
    values.update(changes)
    return InfrastructureRateSnapshot(**values)


def usage(**changes):
    values = dict(stored_bytes=20_000_000, retention_days=30,
                  class_a_operations=8, class_b_operations=12,
                  transfer_bytes=20_000_000,
                  transcoder_hd_output_seconds=9,
                  craft_compute_max_usd=Decimal('0.05'))
    values.update(changes)
    return InfrastructureUsageCeiling(**values)


def generation(exact):
    return CostCeiling('99999999-9999-4999-8999-999999999999', 'generation',
                       'google_veo', 'customer_google_project', Decimal('1.20'),
                       execution_binding_sha256(exact), '9' * 64,
                       NOW - timedelta(hours=1), NOW + timedelta(hours=1),
                       exact.request_operations[0].operation_id)


def test_small_positive_costs_round_up_and_preserve_split_payers():
    exact = binding()
    auxiliary = infrastructure_cost_ceilings(exact, usage(), rates(), now=NOW)
    assert [(item.service, item.max_usd) for item in auxiliary] == [
        ('google_cloud_storage', Decimal('0.01')),
        ('google_transcoder', Decimal('0.01')),
        ('craft_render', Decimal('0.05')),
        ('google_cloud_transfer', Decimal('0.01')),
    ]
    result = composite_quote_readiness(exact, (generation(exact), *auxiliary), now=NOW)
    assert result.complete and result.max_total_usd == '1.28'
    assert result.components_usd == {
        'generation': '1.20', 'storage': '0.01',
        'processing': '0.06', 'transfer': '0.01'}
    assert result.payer_totals_usd == {
        'customer_google_project': '1.23', 'uonify_platform': '0.05'}


def test_zero_unused_service_is_explicit_but_not_billed():
    lines = infrastructure_cost_ceilings(
        binding(), usage(transcoder_hd_output_seconds=0,
                         craft_compute_max_usd=Decimal('0.00')),
        rates(), now=NOW)
    assert lines[1].max_usd == lines[2].max_usd == Decimal('0.00')


@pytest.mark.parametrize('bad_usage,bad_rates', [
    (usage(retention_days=0), rates()),
    (usage(transfer_bytes=21 * 1024 ** 3), rates()),
    (usage(), rates(expires_at=NOW)),
    (usage(), rates(transcoder_hd_minute_usd=Decimal('-0.01'))),
])
def test_invalid_usage_or_unverified_rates_fail_closed(bad_usage, bad_rates):
    with pytest.raises(ValueError):
        infrastructure_cost_ceilings(binding(), bad_usage, bad_rates, now=NOW)

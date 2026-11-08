"""Una aprobación exacta produce un grafo durable pero no abre ejecución."""

from dataclasses import replace
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest

from app.creative_composite_quote import (COMPONENTS, CostCeiling,
    ExecutionBinding, RequestOperationBinding, composite_quote_readiness,
    execution_binding_sha256, canonical_json, canonical_sha256)
from app.creative_execution_graph import (ExecutionApprovalBinding,
    build_execution_graph)


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
                                 REQUEST['model'], REQUEST['endpoint'], REQUEST_JSON),
         RequestOperationBinding('33333333-3333-4333-8333-333333333333',
                                 2, 'shot-02', 'video', REQUEST_SHA,
                                 REQUEST['model'], REQUEST['endpoint'], REQUEST_JSON)),
        'filmcraft', '0.9.0', 'video_export', '1' * 64)


def quote():
    exact = binding()
    bound = execution_binding_sha256(exact)
    costs = tuple(CostCeiling(
        f'{index + 10:08d}-0000-4000-8000-000000000000', component,
        component, 'customer_google_project', Decimal(amount), bound,
        str(index + 3) * 64, NOW - timedelta(minutes=1), NOW + timedelta(hours=1))
        for index, (component, amount) in enumerate(zip(
            COMPONENTS, ('1.20', '0.01', '0.06', '0.01'))))
    return composite_quote_readiness(exact, costs, now=NOW)


def approval(readiness):
    return ExecutionApprovalBinding(
        '99999999-9999-4999-8999-999999999999', readiness.quote_sha256,
        readiness.binding_sha256, readiness.costs_snapshot_sha256,
        readiness.max_total_usd, NOW)


def test_graph_distinguishes_equal_requests_and_orders_storage_craft_review():
    readiness = quote()
    graph = build_execution_graph(readiness, approval(readiness))
    assert [item.kind for item in graph.steps] == [
        'google_generation', 'storage_adopt', 'google_generation',
        'storage_adopt', 'craft', 'review']
    generations = [item for item in graph.steps if item.kind == 'google_generation']
    assert len(generations) == 2
    assert generations[0].request_operation_id != generations[1].request_operation_id
    assert all(item.provider_call for item in graph.steps[:-1])
    assert all(not item.replay_after_start for item in graph.steps)
    assert graph.steps[4].depends_on == (graph.steps[1].step_id,
                                         graph.steps[3].step_id)
    assert graph.steps[5].depends_on == (graph.steps[4].step_id,)
    assert graph.ready_for_persistence and not graph.execution_authorized
    assert not graph.publication_authorized and len(graph.execution_graph_sha256) == 64


def test_graph_is_deterministic_for_idempotent_admission():
    readiness = quote()
    first = build_execution_graph(readiness, approval(readiness))
    second = build_execution_graph(readiness, approval(readiness))
    assert first == second


@pytest.mark.parametrize('change', [
    {'quote_sha256': 'f' * 64}, {'binding_sha256': 'f' * 64},
    {'costs_snapshot_sha256': 'f' * 64}, {'max_total_usd': '9.99'},
])
def test_approval_mismatch_cannot_create_a_graph(change):
    readiness = quote()
    with pytest.raises(ValueError, match='aprobación'):
        build_execution_graph(readiness, replace(approval(readiness), **change))


def test_incomplete_quote_cannot_create_a_graph():
    readiness = quote()
    with pytest.raises(ValueError, match='cotización'):
        build_execution_graph(replace(readiness, complete=False), approval(readiness))


def test_approval_at_or_after_expiry_cannot_create_a_graph():
    readiness = quote()
    expired = replace(approval(readiness),
                      approved_at=NOW + timedelta(hours=1))
    with pytest.raises(ValueError, match='aprobación'):
        build_execution_graph(readiness, expired)

"""Google report protocol fixtures; these tests never access Google or spend credit."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from unittest.mock import Mock, patch
import pytest
import requests
from app.google_billing_reports import (BillingReportError, GoogleBillingReports, ROOT,
    month_period, monetary, parse_page, report_filter, report_name)

PROJECT = 'uonify-fixture'
ID = 'uonify-550e8400-e29b-41d4-a716-446655440000'
NAME = f'projects/{PROJECT}/locations/global/reports/{ID}'
OPERATION = f'projects/{PROJECT}/locations/global/operations/operation-fixture'
START = datetime(2026, 10, 1, 7, tzinfo=timezone.utc)
END = datetime(2026, 10, 15, 21, tzinfo=timezone.utc)


def definition(**changes):
    return {'name': NAME, 'scopes': [{'project': f'projects/{PROJECT}'}],
            'dimensions': ['project'], 'metrics': ['cost'], 'filter': report_filter(START, END),
            'expireTime': (datetime.now(timezone.utc) + timedelta(hours=20)).isoformat(), **changes}


def page(rows=None, **changes):
    columns = [{'name': 'project', 'type': 'STRING', 'mode': 'NULLABLE'},
               {'name': 'cost', 'type': 'RECORD', 'mode': 'NULLABLE', 'columns': [
                   {'name': 'currency_code', 'type': 'STRING', 'mode': 'NULLABLE'},
                   {'name': 'units', 'type': 'INT64', 'mode': 'NULLABLE'},
                   {'name': 'nanos', 'type': 'INT64', 'mode': 'NULLABLE'}]}]
    return {'columns': columns, 'rows': rows if rows is not None else [
        [f'projects/{PROJECT}', {'currency_code': 'EUR', 'units': '1', 'nanos': 980000000}]], **changes}


def provider(*responses):
    result = GoogleBillingReports()
    result._request = Mock(side_effect=list(responses))
    return result


def test_report_create_is_fixed_scoped_and_does_not_generate_content_or_configure_cloud():
    api = provider({'name': OPERATION})
    value = api.create('private-token', PROJECT, ID, START, END)
    assert value == {'reportName': NAME, 'operationName': OPERATION, 'status': 'pending'}
    args = api._request.call_args.args
    assert args[1:4] == (PROJECT, 'POST', f'projects/{PROJECT}/locations/global/reports')
    assert args[4] == {k: v for k, v in definition().items() if k not in ('name', 'expireTime')}
    assert args[5] == {'reportId': ID}
    assert api._request.call_count == 1


def test_ready_operation_and_metadata_match_original_project_scope_filter_and_name():
    api = provider({'name': OPERATION, 'done': True, 'response': definition()}, definition())
    ready = api.poll('private-token', PROJECT, OPERATION, ID, START, END)
    assert ready['status'] == 'ready' and ready['operationName'] == OPERATION
    assert api.metadata('private-token', PROJECT, ID, START, END)['reportName'] == NAME
    assert api._request.call_count == 2


@pytest.mark.parametrize('changes', [
    {'scopes': [{'project': 'projects/someone-else'}]}, {'scopes': []},
    {'metrics': ['resource_cost']}, {'dimensions': ['product_display_name']},
    {'filter': 'hour >= now - duration("72h")'}, {'name': NAME + '-different'},
    {'expireTime': 'no-date'}, {'expireTime': datetime.now(timezone.utc).isoformat()},
    {'expireTime': '2026-10-15T00:00:00'},
])
def test_reconciliation_never_adopts_an_unrelated_report(changes):
    api = provider(definition(**changes))
    with pytest.raises(BillingReportError):
        api.metadata('private-token', PROJECT, ID, START, END)


@pytest.mark.parametrize('project,identifier', [
    ('../private', ID), ('uonify-fixture?key=x', ID), ('project', '../private'),
    (PROJECT, 'foo/bar'), (PROJECT, 'foo?access_token=x'), (PROJECT, 'a' * 64),
    (PROJECT, '-invalid'), (PROJECT, 'invalid-'), (None, ID),
])
def test_untrusted_identifiers_never_reach_transport(project, identifier):
    api = provider()
    with pytest.raises(BillingReportError):
        api.create('private-token', project, identifier, START, END)
    assert not api._request.called


def test_operation_cannot_change_project_name_or_origin():
    api = provider({'name': OPERATION + '-different'})
    with pytest.raises(BillingReportError):
        api.poll('private-token', PROJECT, OPERATION, ID, START, END)
    api = provider()
    for name in ['https://example.test', OPERATION.replace(PROJECT, 'other-project'), OPERATION + '/../private']:
        with pytest.raises(BillingReportError):
            api.poll('private-token', PROJECT, name, ID, START, END)
    assert not api._request.called


@pytest.mark.parametrize('data', [
    {'name': OPERATION, 'done': 'true'}, {'name': OPERATION, 'response': definition()},
    {'name': OPERATION, 'done': True}, {'name': OPERATION, 'done': False, 'error': {'code': 7}},
])
def test_invalid_operation_does_not_announce_readiness(data):
    api = provider(data)
    with pytest.raises(BillingReportError):
        api.create('private-token', PROJECT, ID, START, END)


@pytest.mark.parametrize('code,expected', [(7, 'permission_denied'), (8, 'quota_exceeded'),
                                          (16, 'reauthorize'), (13, 'google_unavailable')])
def test_lro_error_uses_safe_reason_not_provider_message(code, expected):
    api = provider({'name': OPERATION, 'done': True, 'error': {'code': code, 'message': 'private'}})
    with pytest.raises(BillingReportError) as error:
        api.poll('private-token', PROJECT, OPERATION, ID, START, END)
    assert error.value.code == expected and 'private' not in str(error.value)


def test_read_returns_only_exact_eur_gross_cost_and_never_a_credit_balance():
    api = provider(page())
    assert api.read('private-token', PROJECT, ID) == {
        'status': 'available', 'consumptionEUR': '1.98', 'currency': 'EUR', 'rowCount': 1}
    assert api._request.call_args.args == ('private-token', PROJECT, 'POST', NAME + ':read', {'pageSize': 100})


def test_column_positions_and_money_camel_case_are_normalized():
    data = page()
    data['columns'].reverse()
    data['rows'] = [[{'currencyCode': 'EUR', 'units': '0', 'nanos': 5000000}, f'projects/{PROJECT}']]
    assert provider(data).read('private-token', PROJECT, ID)['consumptionEUR'] == '0.01'


@pytest.mark.parametrize('data', [page([]), {'columns': page()['columns']}])
def test_empty_report_is_unknown_and_never_false_zero(data):
    assert provider(data).read('private-token', PROJECT, ID) == {
        'status': 'no_records', 'consumptionEUR': None, 'currency': None, 'rowCount': 0}


def test_zero_requires_an_explicit_eur_money_row_and_small_refund_does_not_show_negative_zero():
    for amount in [{'currency_code': 'EUR'}, {'currencyCode': 'EUR', 'nanos': -4000000}]:
        assert provider(page([[f'projects/{PROJECT}', amount]])).read('private-token', PROJECT, ID)['consumptionEUR'] == '0.00'


@pytest.mark.parametrize('money,expected', [
    ({'currency_code': 'EUR', 'units': '19', 'nanos': 999999999}, Decimal('19.999999999')),
    ({'currencyCode': 'EUR', 'units': '-1', 'nanos': -980000000}, Decimal('-1.98')),
    ({'currencyCode': 'EUR', 'nanos': 1}, Decimal('0.000000001')),
])
def test_money_does_not_round_through_float(money, expected):
    assert monetary(money) == expected


@pytest.mark.parametrize('amount,reason', [
    (None, 'invalid_response'), ({}, 'invalid_response'),
    ({'currency_code': 'USD', 'units': '1'}, 'unsupported_currency'),
    ({'currency_code': 'EUR', 'currencyCode': 'USD'}, 'invalid_response'),
    ({'currency_code': 'EUR', 'units': 1.5}, 'invalid_response'),
    ({'currency_code': 'EUR', 'units': True}, 'invalid_response'),
    ({'currency_code': 'EUR', 'units': 'NaN'}, 'invalid_response'),
    ({'currency_code': 'EUR', 'units': '9223372036854775808'}, 'invalid_response'),
    ({'currency_code': 'EUR', 'nanos': 1000000000}, 'invalid_response'),
    ({'currency_code': 'EUR', 'units': '1', 'nanos': -1}, 'invalid_response'),
    ({'currency_code': 'EUR', 'units': '-1', 'nanos': 1}, 'invalid_response'),
])
def test_invalid_money_never_becomes_a_certified_balance(amount, reason):
    with pytest.raises(BillingReportError) as error:
        provider(page([[f'projects/{PROJECT}', amount]])).read('private-token', PROJECT, ID)
    assert error.value.code == reason


def test_foreign_project_and_changed_report_schema_are_rejected():
    data = page()
    foreign = page([['projects/foreign-project', {'currencyCode': 'EUR', 'units': '1'}]])
    repeated = deepcopy(data)
    repeated['columns'][1]['mode'] = 'REPEATED'
    changed = deepcopy(data)
    changed['columns'][1]['columns'][0]['type'] = 'INT64'
    for candidate in [foreign, repeated, changed, {}, {'columns': None}, {'columns': [1, None]}, page([None])]:
        with pytest.raises(BillingReportError):
            provider(candidate).read('private-token', PROJECT, ID)


def test_pagination_is_bounded_and_does_not_sum_duplicate_project_aggregates():
    first = page([], next_page_token='page-two')
    api = provider(first, page())
    assert api.read('private-token', PROJECT, ID)['consumptionEUR'] == '1.98'
    assert api._request.call_args.args[4] == {'pageSize': 100, 'pageToken': 'page-two'}
    api = provider(page(nextPageToken='page-two'), page())
    with pytest.raises(BillingReportError):
        api.read('private-token', PROJECT, ID)
    api = provider(page([], nextPageToken='same'), page([], nextPageToken='same'))
    with pytest.raises(BillingReportError):
        api.read('private-token', PROJECT, ID)
    api = provider(*(page([], nextPageToken=f'next-{i}') for i in range(5)))
    with pytest.raises(BillingReportError) as error:
        api.read('private-token', PROJECT, ID)
    assert error.value.code == 'too_many_pages' and api._request.call_count == 5


def test_alias_conflicts_and_excessive_rows_do_not_hide_truncation():
    with pytest.raises(BillingReportError):
        parse_page(page([], nextPageToken='one', next_page_token='two'), PROJECT)
    with pytest.raises(BillingReportError) as error:
        parse_page(page([[]] * 1001), PROJECT)
    assert error.value.code == 'too_many_rows'


def test_report_period_uses_billing_pacific_month_and_never_expands_a_partial_month():
    now = datetime(2026, 11, 1, 6, 30, tzinfo=timezone.utc)  # Still October in Pacific time.
    start, end = month_period(now)
    assert start == datetime(2026, 10, 1, 7, tzinfo=timezone.utc) and end == now
    assert report_filter(start, end) == "hour >= timestamp('2026-10-01T07:00:00Z') && hour < timestamp('2026-11-01T06:30:00Z')"
    winter, _ = month_period(datetime(2026, 12, 15, tzinfo=timezone.utc))
    assert winter.hour == 8


@pytest.mark.parametrize('start,end', [(END, START), (START, START),
    (START, START + timedelta(days=91)), (START.replace(tzinfo=None), END)])
def test_invalid_or_unbounded_periods_do_not_reach_google(start, end):
    api = provider()
    with pytest.raises(BillingReportError):
        api.create('private-token', PROJECT, ID, start, end)
    assert not api._request.called


@pytest.mark.parametrize('status,body,expected', [
    (401, {}, 'reauthorize'), (403, {}, 'permission_denied'),
    (403, {'error': {'details': [{'reason': 'SERVICE_DISABLED'}]}}, 'service_disabled'),
    (404, {}, 'not_found'), (409, {}, 'already_exists'), (429, {}, 'quota_exceeded'),
    (500, {'error': {'message': 'private'}}, 'google_unavailable'),
])
def test_transport_maps_errors_without_automatic_retry_or_secret_disclosure(status, body, expected):
    response = Mock(status_code=status)
    response.json.return_value = body
    with patch('app.google_billing_reports.requests.request', return_value=response) as request:
        with pytest.raises(BillingReportError) as error:
            GoogleBillingReports().create('private-token', PROJECT, ID, START, END)
    assert error.value.code == expected and request.call_count == 1
    assert 'private' not in str(error.value)
    assert request.call_args.kwargs['timeout'] == (3.05, 10)
    assert request.call_args.kwargs['allow_redirects'] is False
    assert request.call_args.args == ('POST', ROOT + f'projects/{PROJECT}/locations/global/reports')


def test_network_uncertainty_does_not_create_another_report():
    with patch('app.google_billing_reports.requests.request', side_effect=requests.Timeout()) as request:
        with pytest.raises(BillingReportError) as error:
            GoogleBillingReports().create('private-token', PROJECT, ID, START, END)
    assert error.value.code == 'google_unavailable' and request.call_count == 1


@pytest.mark.parametrize('status,expected', [(200, 'invalid_response'), (401, 'reauthorize')])
def test_non_json_response_keeps_auth_failure_and_never_succeeds(status, expected):
    response = Mock(status_code=status)
    response.json.side_effect = ValueError('private response')
    with patch('app.google_billing_reports.requests.request', return_value=response):
        with pytest.raises(BillingReportError) as error:
            GoogleBillingReports().create('private-token', PROJECT, ID, START, END)
    assert error.value.code == expected

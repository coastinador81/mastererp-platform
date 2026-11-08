"""Los manifiestos ya completados no hacen una consulta de pausa por objeto."""
from unittest.mock import Mock

import pytest

from app.product_materials_queue import BudgetPause
from app.product_materials_worker import process_fragment


ROW = {'id': 'job', 'lease_token': 'lease'}


@pytest.mark.parametrize('state', ['done', 'partial', 'superseded'])
def test_terminal_fragment_does_not_query_pause_credentials_or_provider(state):
    service, credentials, checkpoint = Mock(), Mock(), Mock()
    pause = Mock(side_effect=BudgetPause('user_requested'))
    process_fragment(service, ROW, 'user', {}, {'state': state}, credentials, pause, checkpoint)
    pause.assert_not_called()
    credentials.assert_not_called()
    checkpoint.assert_not_called()
    assert service.mock_calls == []


@pytest.mark.parametrize('state', ['pending', 'running', 'unknown', 'error', 'split'])
def test_active_fragment_obeys_pause_before_reading_or_analyzing(state):
    service, credentials, checkpoint = Mock(), Mock(), Mock()
    pause = Mock(side_effect=BudgetPause('user_requested'))
    with pytest.raises(BudgetPause) as stopped:
        process_fragment(service, ROW, 'user', {}, {'state': state}, credentials, pause, checkpoint)
    assert stopped.value.reason == 'user_requested'
    pause.assert_called_once_with()
    credentials.assert_not_called()
    checkpoint.assert_not_called()
    assert service.mock_calls == []


def test_split_checks_pause_for_pending_child_without_queries_for_terminal_children():
    service, credentials, checkpoint = Mock(), Mock(), Mock()
    fragment = {'id': 'parent', 'source_id': 'source', 'state': 'split'}
    service.queue.fragments.return_value = [
        {'state': state, 'payload': {'parentId': 'parent'}}
        for state in ['done', 'partial', 'superseded', 'pending']]
    pause = Mock(side_effect=[None, BudgetPause('user_requested')])
    with pytest.raises(BudgetPause):
        process_fragment(service, ROW, 'user', {}, fragment, credentials, pause, checkpoint)
    assert pause.call_count == 2  # Parent split and first child that still needs work.
    service.queue.fragments.assert_called_once_with('job', 'user', 'source')
    service.analyzer.analyze.assert_not_called()
    credentials.assert_not_called()
    checkpoint.assert_not_called()

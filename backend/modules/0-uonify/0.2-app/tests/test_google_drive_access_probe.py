"""An access check must not enumerate a customer's Drive contents."""
import pytest

from app.google_cloud_provider import CloudError
from app.google_drive_provider import BASE, GoogleDriveProvider


def test_drive_access_probe_reads_only_root_id():
    provider = GoogleDriveProvider(object())
    calls = []

    def request(token, method, url, body=None, params=None):
        calls.append((token, method, url, body, params))
        return {'id': 'drive-root-id'}

    provider.request = request
    assert provider.probe_access('fixture-token') is True
    assert calls == [('fixture-token', 'GET', BASE + '/root', None,
                      {'fields': 'id', 'supportsAllDrives': 'true'})]


def test_drive_access_probe_requires_a_verified_root():
    provider = GoogleDriveProvider(object())
    provider.request = lambda *_args, **_kwargs: {'files': [{'name': 'private.txt'}]}
    with pytest.raises(CloudError) as error:
        provider.probe_access('fixture-token')
    assert error.value.code == 'invalid_response'


def test_folder_count_paginates_ids_only_and_deduplicates():
    provider = GoogleDriveProvider(object())
    calls = []

    def request(token, method, url, body=None, params=None):
        calls.append((token, method, url, params))
        return ({'files': [{'id': 'a'}, {'id': 'b'}], 'nextPageToken': 'next'}
                if len(calls) == 1 else {'files': [{'id': 'b'}, {'id': 'c'}]})

    provider.request = request
    assert provider.count_folders('fixture-token') == 3
    assert len(calls) == 2
    for _, method, url, params in calls:
        assert method == 'GET' and url == BASE
        assert params['q'] == "mimeType = 'application/vnd.google-apps.folder' and trashed = false"
        assert params['fields'] == 'nextPageToken,incompleteSearch,files(id)'
        assert params['corpora'] == 'user' and params['spaces'] == 'drive'
    assert calls[1][3]['pageToken'] == 'next'


@pytest.mark.parametrize('pages', [
    [{'files': [{'id': 'a'}], 'incompleteSearch': True}],
    [{'files': [{'id': 'a'}], 'nextPageToken': 'same'},
     {'files': [{'id': 'b'}], 'nextPageToken': 'same'}],
    [{'files': [{'name': 'private-folder'}]}],
])
def test_folder_count_refuses_incomplete_or_invalid_pages(pages):
    provider = GoogleDriveProvider(object())
    iterator = iter(pages)
    provider.request = lambda *_args, **_kwargs: next(iterator)
    with pytest.raises(CloudError) as error:
        provider.count_folders('fixture-token')
    assert error.value.code == 'incomplete_search'

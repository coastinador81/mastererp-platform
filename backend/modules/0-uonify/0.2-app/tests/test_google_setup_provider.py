import pytest
from app import google_setup_provider as setup
from app.google_cloud_provider import CloudError


class Response:
    def __init__(self, data=None, code=200):
        self.data, self.status_code, self.content = data or {}, code, b'{}'

    def json(self):
        return self.data

    def raise_for_status(self):
        if self.status_code >= 400:
            raise setup.requests.HTTPError('fixture-only')


def test_minimal_probe_is_one_call_without_customer_content_or_tools(monkeypatch):
    calls = []
    def request(method, url, **kwargs):
        calls.append((method,url,kwargs))
        return Response({'candidates':[{'content':{'parts':[{'text':'Listo.'}]}}],
                         'usageMetadata':{'totalTokenCount':8}})
    monkeypatch.setattr(setup.requests,'request',request)
    assert setup.probe_model('fixture-access','project-fixture') == {'calls':1,'totalTokenCount':8}
    assert len(calls) == 1
    payload = calls[0][2]['json']
    assert payload['generationConfig']['maxOutputTokens'] == 128
    assert 'tools' not in payload and 'systemInstruction' not in payload
    assert calls[0][1].endswith('publishers/google/models/gemini-3.5-flash:generateContent')


def test_project_creation_has_reserved_id_and_never_creates_billing_account(monkeypatch):
    calls = []
    def request(method,url,**kwargs):
        calls.append((method,url,kwargs.get('json')))
        return Response({'name':'operations/cp.123'})
    monkeypatch.setattr(setup.requests,'request',request)
    assert setup.create_project('fixture','uonify-abc123') == 'operations/cp.123'
    assert calls == [('POST','https://cloudresourcemanager.googleapis.com/v3/projects',
                      {'projectId':'uonify-abc123','displayName':'Uonify'})]


def test_operation_names_are_validated_before_http_and_provider_errors_are_bounded(monkeypatch):
    calls = []
    def request(*args,**kwargs):
        calls.append(args)
        return Response(code=403)
    monkeypatch.setattr(setup.requests,'request',request)
    with pytest.raises(CloudError) as bad:
        setup.operation('fixture','https://evil.test/token')
    assert bad.value.code == 'invalid_response' and calls == []
    with pytest.raises(CloudError) as denied:
        setup.operation('fixture','operations/cp.123')
    assert denied.value.code == 'permission_denied' and len(calls) == 1


def test_missing_project_can_be_reconciled_and_incomplete_account_lists_fail(monkeypatch):
    def missing(*args,**kwargs):
        return Response(code=404)
    monkeypatch.setattr(setup.requests,'request',missing)
    assert setup.project('fixture','uonify-abc123') is None
    calls = []
    def paged(*args,**kwargs):
        calls.append(args)
        return Response({'billingAccounts':[],'nextPageToken':'next'})
    monkeypatch.setattr(setup.requests,'request',paged)
    with pytest.raises(CloudError) as error:
        setup.billing_accounts('fixture')
    assert error.value.code == 'too_many_accounts' and len(calls) == 20


def test_real_cloud_adapter_can_link_a_new_project_without_existing_billing(monkeypatch):
    from app.google_cloud_provider import GoogleCloudProvider
    calls, state = [], {'account':None}
    def request(method,url,**kwargs):
        calls.append((method,url,kwargs.get('json')))
        if method == 'PUT':
            state['account'] = kwargs['json']['billingAccountName']
        return Response({'billingEnabled':bool(state['account']),
                         **({'billingAccountName':state['account']} if state['account'] else {})})
    monkeypatch.setattr(setup.requests,'request',request)
    adapter = setup.GoogleSetupProvider(GoogleCloudProvider(None))
    assert adapter.billing_info('fixture','uonify-new-project') == {'name':None,'enabled':False}
    adapter.link_billing('fixture','uonify-new-project','billingAccounts/TEST-123')
    assert adapter.billing_info('fixture','uonify-new-project') == {'name':'billingAccounts/TEST-123','enabled':True}
    assert [item[0] for item in calls] == ['GET','PUT','GET']

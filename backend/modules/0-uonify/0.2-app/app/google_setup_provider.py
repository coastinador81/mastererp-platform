"""Google setup APIs. No account signup, payment activation or customer content."""
import re
import requests
from .google_cloud_provider import CloudError
from .google_setup_diagnostics import response_error
from .uony_models import FLASH


def _request(token, method, url, body=None, params=None, missing=False, quota_project=None):
    try:
        response = requests.request(method,url,headers={'Authorization':'Bearer '+token,
                                    **({'x-goog-user-project':quota_project} if quota_project else {})},
                                    json=body,params=params,timeout=15)
        if missing and response.status_code == 404:
            return None
        if response.status_code >= 400:
            raise response_error(response)
        response.raise_for_status()
        data = response.json() if response.content else {}
        if not isinstance(data,dict):
            raise CloudError('invalid_response')
        return data
    except CloudError:
        raise
    except (requests.RequestException,ValueError,TypeError):
        raise CloudError('google_unavailable') from None


def billing_accounts(token):
    result, page = [], None
    for _ in range(20):
        data = _request(token,'GET','https://cloudbilling.googleapis.com/v1/billingAccounts',
                        params={'pageSize':100,'pageToken':page})
        for account in data.get('billingAccounts',[]):
            name = account.get('name','')
            if re.fullmatch(r'billingAccounts/[A-Za-z0-9-]+',name) and account.get('open') is True:
                result.append({'name':name,'displayName':account.get('displayName',name),'open':True})
        page = data.get('nextPageToken')
        if not page:
            return result
    raise CloudError('too_many_accounts')


def project(token, identifier):
    data = _request(token,'GET',f'https://cloudresourcemanager.googleapis.com/v3/projects/{identifier}',missing=True)
    if data is None:
        return None
    if data.get('projectId') != identifier or data.get('state') != 'ACTIVE':
        raise CloudError('project_not_ready')
    return {'id':identifier,'name':data.get('displayName',identifier),'resource':data['name']}


def create_project(token, identifier):
    data = _request(token,'POST','https://cloudresourcemanager.googleapis.com/v3/projects',
                    {'projectId':identifier,'displayName':'Uonify'})
    return data.get('name')


def operation(token, name):
    if not re.fullmatch(r'operations/[A-Za-z0-9_.-]+',name):
        raise CloudError('invalid_response')
    data = _request(token,'GET',f'https://cloudresourcemanager.googleapis.com/v3/{name}')
    if data.get('error'):
        raise CloudError('permission_denied' if data['error'].get('code') == 7 else 'project_failed')
    return data.get('done') is True


def billing_info(token, identifier):
    data = _request(token,'GET',f'https://cloudbilling.googleapis.com/v1/projects/{identifier}/billingInfo')
    return {'name':data.get('billingAccountName') or None,'enabled':data.get('billingEnabled') is True}


def link_billing(token, identifier, name):
    return _request(token,'PUT',f'https://cloudbilling.googleapis.com/v1/projects/{identifier}/billingInfo',
                    {'billingAccountName':name})


def enable_vertex(token, resource):
    return _request(token,'POST',f'https://serviceusage.googleapis.com/v1/{resource}/services/aiplatform.googleapis.com:enable',{})


def check_model_access(token, identifier):
    """Free CountTokens readiness check; never generates or confirms an answer."""
    try:
        data=_request(token,'POST',f'https://aiplatform.googleapis.com/v1/projects/{identifier}/locations/global/publishers/google/models/{FLASH}:countTokens',
            {'contents':[{'role':'user','parts':[{'text':'Responde únicamente: Listo.'}]}]},quota_project=identifier)
    except CloudError as error:
        if error.code=='not_found':
            error.code='model_unavailable'
        raise
    total=data.get('totalTokens')
    if not isinstance(total,int) or isinstance(total,bool) or total<0:
        raise CloudError('invalid_response')
    return {'totalTokens':total}


def probe_model(token, identifier):
    """Exactly one bounded generate request, without tools or customer material."""
    try:
        data = _request(token,'POST',f'https://aiplatform.googleapis.com/v1/projects/{identifier}/locations/global/publishers/google/models/{FLASH}:generateContent',
            {'contents':[{'role':'user','parts':[{'text':'Responde únicamente: Listo.'}]}],
             'generationConfig':{'maxOutputTokens':128,'thinkingConfig':{'thinkingLevel':'MEDIUM'}}},quota_project=identifier)
    except CloudError as error:
        if error.code=='not_found':
            error.code='model_unavailable'
        raise
    candidates = data.get('candidates',[])
    if not candidates or not any(p.get('text') for p in candidates[0].get('content',{}).get('parts',[])):
        raise CloudError('invalid_response')
    usage = data.get('usageMetadata',{})
    if not isinstance(usage,dict):
        raise CloudError('invalid_response')
    return {'totalTokenCount':usage.get('totalTokenCount'), 'calls':1}


class GoogleSetupProvider:
    """Injection seam: production delegates auth/checks to the existing provider."""
    def __init__(self, cloud):
        self.cloud = cloud

    def billing_info(self, token, identifier):
        # Operational billing_info requires an already linked account. Setup
        # must also represent a new project's legitimate unlinked state.
        try:
            return self.cloud.billing_info(token,identifier)
        except CloudError as error:
            if error.code == 'billing_not_linked':
                return {'name':None,'enabled':False}
            raise

    def __getattr__(self, name):
        existing = getattr(self.cloud,name,None)
        return existing if existing is not None else globals()[name]

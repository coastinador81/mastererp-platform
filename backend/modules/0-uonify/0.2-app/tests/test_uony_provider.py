from unittest.mock import Mock, patch
import pytest
from requests import Timeout
from app.uony_provider import UonyProvider, request_payload
from app.google_cloud_provider import CloudError


def response(parts, finish='STOP'):
    return Mock(status_code=200, json=lambda: {
        'candidates':[{'content':{'role':'model','parts':parts},'finishReason':finish}],
        'usageMetadata':{'totalTokenCount':10},
    })


def test_tool_uses_server_status_and_preserves_model_parts():
    call={'functionCall':{'name':'get_connection_status','args':{}},'thoughtSignature':'fixture-signature'}
    with patch('app.uony_provider.requests.post', side_effect=[
        response([call]), response([{'text':'Interno','thought':True},{'text':'Google está conectado.'}]),
    ]) as post:
        text, usage=UonyProvider().generate('fixture-token','fixture-project',[],{'drive':'connected'})
    assert text=='Google está conectado.' and usage=={
        'calls':2,'attemptedCalls':2,'uncertainCalls':0,
        'totalTokenCount':20,'formRepairCalls':0}
    contents=post.call_args_list[1].kwargs['json']['contents']
    assert contents[-2]['parts']==[call]
    assert contents[-1]['parts'][0]['functionResponse']['response']=={'drive':'connected'}


@pytest.mark.parametrize('call', [
    {'name':'publish_amazon','args':{}},
    {'name':'get_connection_status','args':{'userId':'someone-else'}},
])
def test_rejects_unknown_tools_and_cross_account_arguments(call):
    with patch('app.uony_provider.requests.post', return_value=response([{'functionCall':call}])) as post:
        with pytest.raises(CloudError) as error:
            UonyProvider().generate('fixture-token','fixture-project',[],{})
    assert error.value.code=='invalid_response' and post.call_count==1


def test_tool_loop_is_bounded_and_quota_errors_not_retried():
    with patch('app.uony_provider.requests.post', return_value=response([{'functionCall':{'name':'get_connection_status','args':{}}}])) as post:
        with pytest.raises(CloudError) as error:
            UonyProvider().generate('fixture-token','fixture-project',[],{})
    assert error.value.code=='tool_limit' and post.call_count==3
    with patch('app.uony_provider.requests.post', return_value=Mock(status_code=429)) as post:
        with pytest.raises(CloudError) as error:
            UonyProvider().generate('fixture-token','fixture-project',[],{})
    assert error.value.code=='quota_exceeded' and post.call_count==1
    assert error.value.usage['attemptedCalls']==1
    assert error.value.usage['calls']==0
    assert error.value.usage['uncertainCalls']==1


def test_timeout_is_one_uncertain_attempt_without_automatic_retry():
    with patch('app.uony_provider.requests.post', side_effect=Timeout('fixture timeout')) as post:
        with pytest.raises(CloudError) as error:
            UonyProvider().generate('fixture-token','fixture-project',[],{})
    assert error.value.code=='google_unavailable' and post.call_count==1
    assert error.value.usage['attemptedCalls']==1
    assert error.value.usage['calls']==0
    assert error.value.usage['uncertainCalls']==1


@pytest.mark.parametrize('status', ({}, {'liveHandoffIntent': 'use_drive_materials'}))
def test_drive_permission_prompt_distinguishes_order_from_information(status):
    instruction = request_payload([], status)['systemInstruction']['parts'][0]['text']
    assert 'orden actual, explícita y acotada de buscar o analizar' in instruction
    assert 'buscar, leer o analizar' not in instruction  # Reading a file is not integrated yet.
    assert 'sin otro clic' in instruction or 'No pidas otro clic' in instruction
    assert 'Mencionar que existen archivos' in instruction
    assert 'solo pregunta por su acceso' in instruction
    assert 'espera la siguiente instrucción sin buscar ni analizar documentos' in instruction
    assert 'no llames a ask_user para una pregunta normal' in instruction
    assert 'no llames a show_product_intake' in instruction
    assert 'No se ha autorizado leer Drive, analizar archivos' not in instruction


def test_live_handoff_intent_is_not_itself_drive_authorization():
    instruction = request_payload([], {'liveHandoffIntent': 'use_drive_materials'}
        )['systemInstruction']['parts'][0]['text']
    assert 'etiqueta de intención de voz no concede permisos por sí sola' in instruction
    assert 'atiende únicamente las palabras finales del cliente' in instruction
    assert 'Si solo pidió comprobar el acceso a Drive' in instruction
    assert 'No afirmes que ninguna acción ha comenzado o terminado sin resultado real' in instruction


@pytest.mark.parametrize('effort',['low','medium','high'])
def test_selected_model_and_thinking_level_reach_google(effort):
    with patch('app.uony_provider.requests.post',return_value=response([{'text':'Listo'}])) as post:
        UonyProvider().generate('fixture-token','fixture-project',[],{},model='gemini-3.5-flash-lite',effort=effort)
    assert '/models/gemini-3.5-flash-lite:generateContent' in post.call_args.args[0]
    config=post.call_args.kwargs['json']['generationConfig']
    assert config['thinkingConfig']=={'thinkingLevel':effort.upper()}
    assert 'thinkingBudget' not in config and 'temperature' not in config

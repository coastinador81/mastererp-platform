"""No Google calls: streaming parity, ordering and conservative failure tests."""
import json
from unittest.mock import Mock, patch

import pytest
from requests import Timeout

from app.google_cloud_provider import CloudError
from app.uony_provider import UonyProvider
from app.uony_stream_transport import collect_stream


def sse(*events):
    lines=[]
    for event in events:
        lines.extend(['data: '+json.dumps(event), ''])
    response=Mock(status_code=200, headers={'Content-Type':'text/event-stream'})
    response.iter_lines.return_value=iter(lines)
    return response


def part(text, finish=None, **extra):
    candidate={'content':{'role':'model','parts':[{'text':text,**extra}]},'index':0}
    if finish:
        candidate['finishReason']=finish
    return {'candidates':[candidate]}


def test_collects_ordered_text_without_thought_and_single_final_candidate():
    seen=[]
    result=collect_stream(sse(part('secreto',thought=True),part('Hola '),
        part('mundo',finish='STOP'),{'usageMetadata':{'totalTokenCount':13}}),seen.append)
    assert seen==['Hola ','Hola mundo']
    assert result['usageMetadata']['totalTokenCount']==13
    assert [item['text'] for item in result['candidates'][0]['content']['parts']]==[
        'secreto','Hola mundo']


def test_streaming_preserves_tool_turn_and_model_selection_without_extra_calls():
    tool={'functionCall':{'name':'get_connection_status','args':{}},
          'thoughtSignature':'fixture-signature'}
    first=sse({'candidates':[{'index':0,'content':{'role':'model','parts':[tool]},
                              'finishReason':'STOP'}],
               'usageMetadata':{'totalTokenCount':7}})
    second=sse(part('Google ',finish=None),part('conectado.',finish='STOP'),
               {'usageMetadata':{'totalTokenCount':8}})
    prefixes=[];clears=[];attempts=[];completions=[]
    with patch('app.uony_provider.requests.post',side_effect=[first,second]) as post:
        text,usage=UonyProvider().generate('fixture','project-fixture',[],{'drive':'connected'},
            model='gemini-3.5-flash',effort='medium',streaming=True,
            on_text=prefixes.append,on_clear=lambda:clears.append(True),
            on_attempt=attempts.append,
            on_complete=lambda ordinal,reported:completions.append((ordinal,dict(reported))))
    assert text=='Google conectado.'
    assert prefixes==['Google ','Google conectado.']
    assert attempts==[1,2] and [value[0] for value in completions]==[1,2]
    assert usage=={'totalTokenCount':15,'calls':2,'attemptedCalls':2,
                   'uncertainCalls':0,'formRepairCalls':0}
    assert post.call_count==2
    assert all(':streamGenerateContent?alt=sse' in item.args[0]
               and item.kwargs['stream'] is True for item in post.call_args_list)
    assert post.call_args_list[1].kwargs['json']['contents'][-2]['parts']==[tool]
    assert post.call_args_list[1].kwargs['json']['contents'][-1]['parts'][0][
        'functionResponse']['response']=={'drive':'connected'}
    assert all(item.kwargs['json']['generationConfig']['maxOutputTokens']==2048
               for item in post.call_args_list)


def test_partial_function_arguments_are_rejected_without_executing_tool():
    bad=sse({'candidates':[{'content':{'role':'model','parts':[
        {'functionCall':{'name':'get_connection_status','partialArgs':[{'jsonPath':'$.x'}],
                         'willContinue':True}}]},'finishReason':'STOP'}]})
    with patch('app.uony_provider.requests.post',return_value=bad) as post:
        with pytest.raises(CloudError) as failure:
            UonyProvider().generate('fixture','project-fixture',[],{},streaming=True)
    assert failure.value.code=='invalid_response'
    assert failure.value.usage['attemptedCalls']==1
    assert failure.value.usage['uncertainCalls']==1
    assert post.call_count==1


def test_text_before_tool_is_withdrawn_before_tool_response():
    tool={'functionCall':{'name':'get_connection_status','args':{}}}
    first=sse(part('Todavía no confirmado'),
              {'candidates':[{'content':{'role':'model','parts':[tool]},
                              'finishReason':'STOP'}]})
    second=sse(part('Respuesta guardada',finish='STOP'))
    visible=[];cleared=[]
    with patch('app.uony_provider.requests.post',side_effect=[first,second]) as post:
        answer,usage=UonyProvider().generate('fixture','project-fixture',[],
            {'drive':'connected'},streaming=True,on_text=visible.append,
            on_clear=lambda:cleared.append(True))
    assert answer=='Respuesta guardada'
    assert visible==['Todavía no confirmado','Respuesta guardada']
    assert len(cleared)>=2 and post.call_count==2 and usage['calls']==2


def test_incomplete_stream_clears_tentative_text_and_never_retries():
    incomplete=sse(part('Provisional'))
    seen=[];clears=[]
    with patch('app.uony_provider.requests.post',return_value=incomplete) as post:
        with pytest.raises(CloudError) as failure:
            UonyProvider().generate('fixture','project-fixture',[],{},streaming=True,
                on_text=seen.append,on_clear=lambda:clears.append(True))
    assert seen==['Provisional'] and len(clears)>=2
    assert failure.value.code=='invalid_response' and post.call_count==1
    assert failure.value.usage['uncertainCalls']==1


def test_timeout_has_one_uncertain_stream_attempt():
    with patch('app.uony_provider.requests.post',side_effect=Timeout('fixture')) as post:
        with pytest.raises(CloudError) as failure:
            UonyProvider().generate('fixture','project-fixture',[],{},streaming=True)
    assert failure.value.code=='google_unavailable' and post.call_count==1
    assert failure.value.usage['attemptedCalls']==1
    assert failure.value.usage['calls']==0
    assert failure.value.usage['uncertainCalls']==1

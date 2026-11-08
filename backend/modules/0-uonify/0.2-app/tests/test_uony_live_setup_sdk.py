"""Compare the Live setup payload with the pinned Google SDK offline."""
from dataclasses import replace
import json

from google import genai
from google.auth.credentials import AnonymousCredentials
from google.genai import _common, _live_converters, types

from app.uony_live_vertex import VertexLiveProvider
from test_uony_live_vertex import FakeCloud, prepared, run_server_test


def test_vertex_setup_matches_pinned_google_sdk_converter_offline(environment, monkeypatch):
    settings, database, identity = prepared(environment)
    identity = replace(identity, context='user: Quiero crear una lámpara.')
    adapter = VertexLiveProvider(settings, database, FakeCloud(), location='eu')
    seen = {}

    async def server(ws):
        seen['setup'] = json.loads(await ws.recv())['setup']
        await ws.send(json.dumps({'setupComplete': {}}))

    async def client():
        session = await adapter.open(identity)
        await session.close()

    server.client = client
    run_server_test(monkeypatch, server)

    # AUDIO output and independent transcriptions; TEXT as a second response
    # modality can reject setup. The long-running handoff is NON_BLOCKING.
    sdk = genai.Client(vertexai=True, project=identity.project_id, location='eu',
                       credentials=AnonymousCredentials())
    config = types.LiveConnectConfig(
        response_modalities=['AUDIO'],
        explicit_vad_signal=True,
        input_audio_transcription=types.AudioTranscriptionConfig(),
        output_audio_transcription=types.AudioTranscriptionConfig(),
        system_instruction=types.Content(parts=[types.Part(
            text=seen['setup']['systemInstruction']['parts'][0]['text'])]),
        tools=[types.Tool(function_declarations=[
            types.FunctionDeclaration(
                name='get_current_work',
                description=('Consulta el estado real de los encargos de este cliente. '
                    'Solo lectura del encargo y último traspaso; no crea ni ejecuta trabajos.'),
                parameters=types.Schema(type=types.Type.OBJECT, properties={})),
            types.FunctionDeclaration(
                name='route_spoken_request', behavior='NON_BLOCKING',
                description=('Traspasa una petición hablada al trabajo persistente '
                    'del mismo chat. Incluye cita literal completa del turno en spokenText. '
                    'Enruta planificación creativa, creación de producto, orden de buscar o analizar Drive, '
                    'conteo de carpetas o petición de comprobar acceso a Drive. La herramienta por sí sola no lee Drive ni '
                    'guarda productos ni genera medios; el backend valida el alcance antes de actuar.'),
                parameters=types.Schema(type=types.Type.OBJECT,
                    properties={'intent': types.Schema(type=types.Type.STRING,
                        enum=['create_product', 'use_drive_materials', 'creative_plan']),
                        'spokenText': types.Schema(type=types.Type.STRING)},
                    required=['intent', 'spokenText']))])],
    )
    params = types.LiveConnectParameters(
        model=(f'projects/{identity.project_id}/locations/eu/publishers/google/'
               'models/gemini-3.8-live'), config=config)
    sdk_message = _common.convert_to_dict(
        _live_converters._LiveConnectParameters_to_vertex(
            sdk._api_client, params.model_dump(exclude_none=True)))
    assert seen['setup'] == sdk_message['setup']

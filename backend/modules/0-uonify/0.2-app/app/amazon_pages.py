"""Pantallas mínimas del retorno público; nunca incluyen códigos o credenciales."""
from html import escape
import json
from fastapi.responses import HTMLResponse
from .security import random_token

STYLE = '''body{margin:0;background:#f6f9ff;color:#18324a;font:16px system-ui,sans-serif;
display:grid;min-height:100vh;place-items:center}main{margin:24px;padding:36px;
max-width:480px;background:white;border:1px solid #d6e4f7;border-radius:24px}
.brand{font-weight:800;color:#2584bc;letter-spacing:2px}h1{font-size:24px;line-height:1.25}
p{line-height:1.6;color:#607b98}a,button{display:inline-block;background:#255cba;color:white;
padding:14px 20px;border:0;border-radius:12px;text-decoration:none;font:inherit;cursor:pointer}'''


def page(title, message, local_origin, flow_id=None, intent=None, status=200):
    nonce = random_token()
    destination = local_origin + ('/?amazon_intent=' + intent if intent else '/')
    if intent:
        control = f'<a href="{escape(destination, quote=True)}" target="_blank" rel="noopener">Continuar en Uonify</a>'
        script = ''
    else:
        control = ('<button id="return">Cerrar y volver a Uonify</button>'
                   '<p>Si esta ventana no se cierra, puedes cerrarla y volver a tu pestaña original de Uonify. Tu conversación sigue allí.</p>')
        script = '''const origin=ORIGIN;
const notify=()=>{try{if(window.opener&&!window.opener.closed){
window.opener.postMessage({type:'uonify-amazon-return',flowId:FLOW},origin);
window.opener.focus();}}catch{}};
document.getElementById('return').onclick=()=>{notify();window.close();};
notify();if(FLOW)setTimeout(()=>window.close(),200);'''.replace('ORIGIN', json.dumps(local_origin)).replace('FLOW', json.dumps(flow_id))
    response = HTMLResponse(f'''<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>{escape(title)} · Uonify</title>
<style nonce="{nonce}">{STYLE}</style></head><body><main><div class="brand">UONIFY</div>
<h1>{escape(title)}</h1><p>{escape(message)}</p>{control}</main>
<script nonce="{nonce}">{script}</script></body></html>''', status_code=status)
    response.headers['Content-Security-Policy'] = (f"default-src 'none'; style-src 'nonce-{nonce}'; "
        f"script-src 'nonce-{nonce}'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'")
    return response


def result_page(origin, flow_id=None, error=None):
    message = 'La conexión se ha guardado. Puedes continuar en tu pestaña de Uonify.'
    if error:
        message = {'seller_conflict': 'Este vendedor ya está vinculado a otra cuenta de Uonify.',
                   'seller_changed': 'Desconecta el vendedor actual en Uonify antes de vincular otro.',
                   'denied': 'No has autorizado la conexión. Tu trabajo sigue guardado.',
                   'session_or_subscription': 'Revisa tu sesión y tu suscripción en Uonify para continuar.'}.get(
                       error, 'La conexión no se ha completado. Vuelve a tu pestaña de Uonify para intentarlo de nuevo.')
    return page('Amazon conectado' if not error else 'No se ha completado la conexión', message,
                origin, flow_id=flow_id, status=400 if error else 200)

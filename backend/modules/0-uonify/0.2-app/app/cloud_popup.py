"""Resultado de ventana OAuth: notificación sin tokens, vinculada a la sesión iniciadora."""
from fastapi import HTTPException
from fastapi.responses import HTMLResponse
from .security import SESSION_COOKIE, digest, random_token
from .onboarding import require_user


def result_page(success, flow_id, error=None):
    nonce = random_token()
    title = 'Cuenta conectada' if success else 'No se ha completado la conexión'
    message = 'Puedes continuar en la ventana de Uonify.' if success else 'Vuelve a Uonify para intentarlo de nuevo. Tu progreso sigue guardado.'
    if error == 'account_mismatch':
        message = 'Usa la misma cuenta de Google con la que has iniciado sesión en Uonify. La otra cuenta no se ha conectado.'
    response = HTMLResponse(f'''<!doctype html><html lang="es"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>{title} · Uonify</title>
<body><main><p>UONIFY</p><h1>{title}</h1><p>{message}</p>
<button id="close">Volver a la ventana de Uonify</button></main>
<script nonce="{nonce}">
const finish=()=>{{
  try {{ const channel=new BroadcastChannel('uonify-google-return'); channel.postMessage({{flowId:'{flow_id}'}}); channel.close(); }} catch {{}}
  setTimeout(()=>window.close(),150);
}};
document.getElementById('close').onclick=finish; finish();
</script></body></html>''')
    response.headers['Content-Security-Policy'] = f"default-src 'none'; script-src 'nonce-{nonce}'; frame-ancestors 'none'; base-uri 'none'"
    return response


def finish_popup(database, request, state, error):
    with database.connect() as connection:
        flow = connection.execute('''UPDATE cloud_popup_flows SET status=%s,error_code=%s
            WHERE id=%s AND session_hash=%s AND expires_at>now() AND status='pending'
            AND EXISTS(SELECT 1 FROM users WHERE users.id=cloud_popup_flows.user_id
                AND users.deletion_requested_at IS NULL) RETURNING id''',
            ('error' if error else 'success', error if error == 'account_mismatch' else None, digest(state), digest(request.cookies.get(SESSION_COOKIE,'')))).fetchone()
        # El modo de ventana no es una credencial. Incluso caducado/cancelado debe
        # cerrarse, nunca redirigir el onboarding al popup. El éxito sigue validado.
        popup = flow or connection.execute('SELECT 1 FROM cloud_popup_flows WHERE id=%s', (digest(state),)).fetchone()
    if popup or state.startswith('cloud_popup_'):
        return result_page(bool(flow) and not error, digest(state), error)
    return None


def popup_status(database, request, flow_id):
    with database.connect() as connection:
        user = require_user(connection, request)
        row = connection.execute('''SELECT status,error_code FROM cloud_popup_flows
            WHERE id=%s AND user_id=%s AND session_hash=%s AND expires_at>now()''',
            (flow_id,user['id'],digest(request.cookies.get(SESSION_COOKIE,'')))).fetchone()
    if not row:
        raise HTTPException(404, detail={'error':'flow_expired','message':'La conexión ha caducado. Puedes volver a intentarlo.'})
    return {'status': row['status'], **({'error': row['error_code']} if row['error_code'] else {})}

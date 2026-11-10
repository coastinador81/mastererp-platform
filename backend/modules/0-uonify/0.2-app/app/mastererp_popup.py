"""Resultado de la ventana del ERP, como el de Drive: aviso sin tokens, ligado a la sesión que la
abrió. La página solo despierta a la web por BroadcastChannel; nunca concede nada."""
import re
from fastapi import HTTPException
from fastapi.responses import HTMLResponse
from .security import SESSION_COOKIE, digest, random_token
from .onboarding import require_user

CHANNEL = 'uonify-erp-return'
FLOW_ID = re.compile(r'[0-9a-f]{64}')
# Únicos motivos que la ventana guarda para la web; el resto es un error genérico.
FLOW_ERRORS = ('account_mismatch', 'not_linked')
PAGES = {
    'success': ('Cuenta conectada', 'Puedes continuar en la ventana de Uonify.'),
    'error': ('No se ha completado la conexión',
              'Vuelve a Uonify para intentarlo de nuevo. Tu progreso sigue guardado.'),
    'account_mismatch': ('No se ha completado la conexión',
                         'Entra con la misma cuenta del ERP que conectaste la primera vez. Para usar '
                         'otra, desconecta antes la actual desde Uonify. La otra cuenta no se ha conectado.'),
    'not_linked': ('Tu cuenta aún no tiene acceso',
                   'Tu cuenta del ERP todavía no tiene acceso a ningún espacio. Pide acceso a quien lo '
                   'administra y vuelve a conectar desde Uonify.'),
}


def result_page(success, flow_id, error=None):
    nonce = random_token()
    title, message = PAGES['success' if success else error if error in FLOW_ERRORS else 'error']
    response = HTMLResponse(f'''<!doctype html><html lang="es"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>{title} · Uonify</title>
<body><main><p>UONIFY</p><h1>{title}</h1><p>{message}</p>
<button id="close">Volver a la ventana de Uonify</button></main>
<script nonce="{nonce}">
const finish=()=>{{
  try {{ const channel=new BroadcastChannel('{CHANNEL}'); channel.postMessage({{flowId:'{flow_id}'}}); channel.close(); }} catch {{}}
  setTimeout(()=>window.close(),150);
}};
document.getElementById('close').onclick=finish; finish();
</script></body></html>''')
    response.headers['Content-Security-Policy'] = f"default-src 'none'; script-src 'nonce-{nonce}'; frame-ancestors 'none'; base-uri 'none'"
    return response


def finish_popup(database, request, state, error):
    with database.connect() as connection:
        flow = connection.execute('''UPDATE erp_popup_flows SET status=%s,error_code=%s
            WHERE id=%s AND session_hash=%s AND expires_at>now() AND status='pending'
            AND EXISTS(SELECT 1 FROM users WHERE users.id=erp_popup_flows.user_id
                AND users.deletion_requested_at IS NULL) RETURNING id''',
            ('error' if error else 'success', error if error in FLOW_ERRORS else None, digest(state),
             digest(request.cookies.get(SESSION_COOKIE, '')))).fetchone()
        # El modo de ventana no es una credencial: aunque haya caducado o se haya cancelado, la
        # ventana se cierra y nunca redirige la web dentro de ella. El éxito sigue validado.
        popup = flow or connection.execute('SELECT 1 FROM erp_popup_flows WHERE id=%s', (digest(state),)).fetchone()
    if popup or state.startswith('erp_popup_'):
        return result_page(bool(flow) and not error, digest(state), error)
    return None


def popup_status(database, request, flow_id):
    with database.connect() as connection:
        user = require_user(connection, request)
        row = None if not FLOW_ID.fullmatch(flow_id) else connection.execute(
            '''SELECT status,error_code FROM erp_popup_flows
            WHERE id=%s AND user_id=%s AND session_hash=%s AND expires_at>now()''',
            (flow_id, user['id'], digest(request.cookies.get(SESSION_COOKIE, '')))).fetchone()
    if not row:
        raise HTTPException(404, detail={'error': 'flow_expired', 'message': 'La conexión ha caducado. Puedes volver a intentarlo.'})
    return {'status': row['status'], **({'error': row['error_code']} if row['error_code'] else {})}

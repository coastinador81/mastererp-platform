"""Comprobación operativa explícita: python -m app.check_uony_models correo.

Consume hasta nueve peticiones cortas en el proyecto autorizado. No imprime
credenciales ni contenido del cliente. No se ejecuta al iniciar el servidor.
"""
import sys
from cryptography.fernet import Fernet
from .settings import load_settings
from .database import Database
from .google_cloud_provider import GoogleCloudProvider, CloudError
from .uony_provider import UonyProvider
from .uony_models import MODELS, EFFORTS
from .google_account import require_same_connection
from .access import workspace_access


def main(email):
    settings=load_settings(); db=Database(settings.database); db.migrate()
    with db.connect() as c:
        user=c.execute('SELECT * FROM users WHERE email=%s',(email,)).fetchone()
        if not user or workspace_access(c,user)['status']!='allowed':
            raise SystemExit('La cuenta no tiene acceso vigente.')
        cloud=c.execute('SELECT * FROM google_cloud_connections WHERE user_id=%s',(user['id'],)).fetchone()
        if not cloud or cloud['status']!='connected' or not (cloud['project_check'] or {}).get('ready'):
            raise SystemExit('El proyecto debe estar conectado y comprobado.')
        require_same_connection(user, cloud)
    try:
        token=GoogleCloudProvider(settings).refresh(Fernet(settings.encryption_key).decrypt(cloud['refresh_encrypted'].encode()).decode())
    except CloudError as error:raise SystemExit(error.code) from None
    for model in MODELS:
        for effort in EFFORTS:
            try:
                _,usage=UonyProvider().generate(token,cloud['project_id'],[{'role':'user','parts':[{'text':'Prueba técnica de conexión. Responde únicamente: Listo.'}]}],{},model=model['id'],effort=effort['id'])
                with db.connect() as c:
                    current=c.execute('SELECT google_subject,project_id,status FROM google_cloud_connections WHERE user_id=%s',(user['id'],)).fetchone()
                    if not current or current['status']!='connected' or current['google_subject']!=cloud['google_subject'] or current['project_id']!=cloud['project_id']:
                        raise SystemExit('La conexión ha cambiado; comprobación detenida.')
                    c.execute('INSERT INTO uony_model_checks(user_id,project_id,google_subject,model,effort) VALUES(%s,%s,%s,%s,%s) ON CONFLICT(user_id,project_id,google_subject,model,effort) DO UPDATE SET checked_at=now()', (user['id'],cloud['project_id'],cloud['google_subject'],model['id'],effort['id']))
                print(model['id'],effort['id'],'OK',usage,flush=True)
            except CloudError as error:
                print(model['id'],effort['id'],'NO DISPONIBLE',error.code,flush=True)

if __name__=='__main__': main(sys.argv[1])

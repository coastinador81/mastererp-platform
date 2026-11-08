"""Preparación explícita para las pruebas de cobro, sin conceder acceso a herramientas."""
from psycopg.types.json import Jsonb
from app.uony_models import FLASH


def ready_setup(database, subject):
    with database.connect() as connection:
        user = connection.execute('SELECT * FROM users WHERE google_subject=%s', (subject,)).fetchone()
        connection.execute('INSERT INTO drive_onboarding_preferences(user_id) VALUES(%s) ON CONFLICT DO NOTHING', (user['id'],))
        connection.execute('''INSERT INTO google_cloud_connections(user_id,google_subject,email,refresh_encrypted,scope,
            project_id,project_name,project_check) VALUES(%s,%s,%s,'fixture','cloud-platform','uonify-fixture','Uonify',%s)
            ON CONFLICT(user_id) DO UPDATE SET project_check=EXCLUDED.project_check''',
            (user['id'], subject, user['email'], Jsonb({'ready':True})))
        connection.execute('''INSERT INTO uony_model_checks(user_id,project_id,google_subject,model,effort)
            VALUES(%s,'uonify-fixture',%s,%s,'medium') ON CONFLICT DO NOTHING''', (user['id'], subject, FLASH))

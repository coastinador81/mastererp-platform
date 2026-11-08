"""Alta local de un administrador (CLI de operador). No es un endpoint; se ejecuta en el servidor.

Crea/actualiza un admin real, genera su secreto TOTP (cifrado en reposo) y códigos de recuperación,
y muestra el enrolamiento (URI otpauth + códigos) UNA sola vez por stdout para apuntarlo en la app de
autenticación. No imprime secretos por el chat; ejecútalo en el terminal del servidor. Uso:

    python -m app.admin_setup --email persona@uonify.com --name "Nombre" --role superadmin
"""
import argparse
import secrets
import sys
from uuid import uuid4
from cryptography.fernet import Fernet
from .database import Database
from .settings import load_settings
from .security import digest
from .admin_totp import generate_secret, otpauth_uri

ROLES = ('superadmin', 'operaciones', 'soporte', 'finanzas', 'lectura')


def main(argv=None):
    parser = argparse.ArgumentParser(description='Alta local de un administrador de la consola.')
    parser.add_argument('--email', required=True)
    parser.add_argument('--name', required=True)
    parser.add_argument('--role', required=True, choices=ROLES)
    args = parser.parse_args(argv)

    email = args.email.strip().lower()
    if '@' not in email or len(email) > 254:
        parser.error('Correo no válido.')

    settings = load_settings()
    database = Database(settings.database)
    database.migrate()
    cipher = Fernet(settings.encryption_key)

    secret = generate_secret()
    recovery = [secrets.token_hex(5) for _ in range(8)]
    with database.connect() as connection:
        admin = connection.execute(
            '''INSERT INTO admin_users (id, email, name, role, totp_secret_encrypted)
               VALUES (%s,%s,%s,%s,%s)
               ON CONFLICT (email) DO UPDATE SET name = excluded.name, role = excluded.role,
                   totp_secret_encrypted = excluded.totp_secret_encrypted, status = 'active', updated_at = now()
               RETURNING id''',
            (uuid4(), email, args.name.strip(), args.role, cipher.encrypt(secret.encode()).decode())).fetchone()
        connection.execute('DELETE FROM admin_recovery_codes WHERE admin_id = %s', (admin['id'],))
        for code in recovery:
            connection.execute('INSERT INTO admin_recovery_codes (id, admin_id, code_hash) VALUES (%s,%s,%s)',
                               (uuid4(), admin['id'], digest(code)))

    print(f'Administrador listo: {email} ({args.role}).')
    print('')
    print('=== SECRETO 2FA — SOLO PARA EL DUEÑO. No lo pegues en chats, tickets ni registros. ===')
    print('Enrola este secreto en tu app de autenticación (Google Authenticator, 1Password, etc.):')
    print('  ' + otpauth_uri(secret, email))
    print('Códigos de recuperación de un solo uso (guárdalos en lugar seguro; no se vuelven a mostrar):')
    for code in recovery:
        print('  ' + code)
    print('=== Fin del secreto. Limpia/cierra esta terminal al terminar de enrolarlo. ===')
    print('')
    print('El código de acceso de 6 dígitos llega al correo (en local, al buzón Mailpit http://127.0.0.1:8025).')
    return 0


if __name__ == '__main__':
    sys.exit(main())

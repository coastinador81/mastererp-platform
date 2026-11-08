"""Fija la contraseña de un administrador (CLI de operador, SOLO local/desarrollo). No es un endpoint.

La contraseña la teclea el DUEÑO en su terminal (getpass, oculta); NUNCA va por argumento, chat ni historial.
Se guarda hasheada (PBKDF2). Requiere que el admin ya exista (créalo antes con admin_setup). Uso:

    python -m app.admin_set_password --email daniel@uonify.com
"""
import argparse
import getpass
import sys
from .database import Database
from .settings import load_settings
from .admin_security import hash_password


def main(argv=None):
    parser = argparse.ArgumentParser(description='Fija la contraseña de un admin (login local).')
    parser.add_argument('--email', required=True)
    args = parser.parse_args(argv)
    email = args.email.strip().lower()
    if '@' not in email or len(email) > 254:
        parser.error('Correo no válido.')

    settings = load_settings()
    database = Database(settings.database)
    database.migrate()

    password = getpass.getpass(f'Contraseña nueva para {email}: ')
    if len(password) < 10:
        print('Usa al menos 10 caracteres.')
        return 1
    if password != getpass.getpass('Repite la contraseña: '):
        print('Las contraseñas no coinciden.')
        return 1

    with database.connect() as connection:
        updated = connection.execute(
            "UPDATE admin_users SET password_hash=%s, updated_at=now() WHERE email=%s AND status='active'",
            (hash_password(password), email)).rowcount
    if not updated:
        print('No existe un admin activo con ese correo. Créalo antes con admin_setup.')
        return 1
    print(f'Contraseña fijada para {email}.')
    return 0


if __name__ == '__main__':
    sys.exit(main())

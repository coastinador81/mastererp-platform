"""Una identidad Google verificada para acceso, Cloud y Drive."""
from fastapi import HTTPException

ACCOUNT_MISMATCH = 'Autoriza Google con la misma cuenta con la que has iniciado sesión en Uonify. Para usar otra, cierra sesión e inicia sesión con ella.'


def same_account(user, subject):
    # El correo puede cambiar; el sub verificado de Google es la identidad estable.
    return bool(user.get('google_subject') and subject and user['google_subject'] == subject)


def connection_matches(user, row):
    return bool(row and same_account(user, row.get('google_subject')) and row.get('status') != 'account_mismatch')


def require_same_connection(user, row):
    if not connection_matches(user, row):
        raise HTTPException(409, detail={'error': 'account_mismatch', 'message': ACCOUNT_MISMATCH})

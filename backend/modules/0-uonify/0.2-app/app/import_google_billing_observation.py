"""Administrative evidence import, never a customer-editable balance endpoint.

python -m app.import_google_billing_observation --email ... --snapshot /proof/observation.json --evidence-dir /proof
The operator must first verify each amount in the connected account's Google console.
Only identifiers and success are printed; credentials and proof content are never logged.
"""
import argparse
from pathlib import Path
from cryptography.fernet import Fernet
from fastapi import HTTPException
from pydantic import ValidationError
from .access import workspace_access
from .database import Database
from .google_account import require_same_connection
from .google_billing_observations import Observation, proof_files, record
from .google_cloud_provider import GoogleCloudProvider, CloudError
from .settings import load_settings


def import_observation(settings, database, provider, email, observation, proofs):
    with database.connect() as connection:
        user = connection.execute('SELECT * FROM users WHERE email=%s FOR UPDATE', (email,)).fetchone()
        if not user or workspace_access(connection, user)['status'] != 'allowed':
            raise ValueError('La cuenta no tiene acceso vigente.')
        cloud = connection.execute('SELECT * FROM google_cloud_connections WHERE user_id=%s FOR UPDATE', (user['id'],)).fetchone()
        if not cloud or cloud['status'] != 'connected':
            raise ValueError('Google debe estar conectado.')
        require_same_connection(user, cloud)
        if cloud['project_id'] != observation.projectId:
            raise ValueError('El proyecto no coincide con la conexión vigente.')
        token = provider.refresh(Fernet(settings.encryption_key).decrypt(cloud['refresh_encrypted'].encode()).decode())
        info = provider.billing_info(token, cloud['project_id'])
        account = provider.billing_account(token, info['name'])
        if account['name'] != observation.billingAccountName:
            raise ValueError('La cuenta de facturación no coincide con Google.')
        if not info['enabled'] or not account['open']:
            raise ValueError('La facturación debe estar activa y la cuenta abierta para registrar el saldo disponible.')
        return record(connection, user, cloud, observation, proofs)


def main():
    parser = argparse.ArgumentParser(description='Guardar una observación verificada de Google Billing.')
    parser.add_argument('--email', required=True)
    parser.add_argument('--snapshot', required=True)
    parser.add_argument('--evidence-dir', required=True)
    args = parser.parse_args()
    try:
        observation = Observation.model_validate_json(Path(args.snapshot).read_text())
        proofs = proof_files(args.evidence_dir, observation.proofFiles)
        settings = load_settings()
        database = Database(settings.database)
        database.migrate()
        added = import_observation(settings, database, GoogleCloudProvider(settings), args.email, observation, proofs)
    except (ValueError, OSError, ValidationError, CloudError, HTTPException):
        raise SystemExit('No se importó la observación. Revisa la cuenta, los importes, las fechas y las evidencias.') from None
    print('Observación verificada guardada.' if added else 'La observación ya estaba guardada; no se duplicó.')


if __name__ == '__main__':
    main()

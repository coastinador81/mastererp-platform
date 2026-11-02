"""Diagnóstico técnico de Administración; sin lógica de negocio."""
import json


def lambda_handler(event, context):
    """Devuelve únicamente la identificación de esta función."""
    return {
        "statusCode": 200,
        "headers": {"Content-Type": "application/json", "Cache-Control": "no-store"},
        "body": json.dumps({"status": "ok", "lambda": "mastererp-dev-adm-cartera"}),
    }

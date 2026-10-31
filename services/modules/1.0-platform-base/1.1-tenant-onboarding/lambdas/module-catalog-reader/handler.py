from tenant_onboarding.handlers.router import handle_admin_request


def lambda_handler(event, context):
    return handle_admin_request(event, invoke_provisioner=False)

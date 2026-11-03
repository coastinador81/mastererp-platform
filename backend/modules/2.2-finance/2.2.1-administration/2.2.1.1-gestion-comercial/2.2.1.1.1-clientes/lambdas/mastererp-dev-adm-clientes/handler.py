from parties import handle

def lambda_handler(event, context):
    return handle(event, context, role='cliente', capability='clientes')

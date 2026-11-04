"""Basic purchase drafts; existing technical health route is preserved."""
from purchases import handle

def lambda_handler(event, context):
    return handle(event, context)

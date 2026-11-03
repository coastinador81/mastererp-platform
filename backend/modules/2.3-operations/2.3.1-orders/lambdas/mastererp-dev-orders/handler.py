"""Lambda entry point; package root must include orders_api and tenant_security."""
from orders_api.handler import lambda_handler

__all__ = ["lambda_handler"]

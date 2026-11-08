"""Proceso aislado. Docker publica su puerto únicamente en el loopback de la Mac."""
import uvicorn
import os
from .settings import load_settings
from .amazon_gateway import create_gateway

if __name__ == '__main__':
    host = '0.0.0.0' if os.environ.get('UONIFY_CONTAINER') == '1' else '127.0.0.1'
    uvicorn.run(create_gateway(load_settings()), host=host, port=8001,
                access_log=False, proxy_headers=False)

import logging
import uvicorn
from .main import create_app
from .settings import load_settings

if __name__ == '__main__':
    # Enable only content-free Uony phase measurements, never SDK/HTTP bodies.
    logging.basicConfig(level=logging.WARNING, format='%(asctime)s %(message)s')
    for name in ('app.uony_live_result_speech', 'app.uony_live_semantic',
                 'app.uony_semantic_classifier'):
        logging.getLogger(name).setLevel(logging.INFO)
    # El puerto del contenedor solo se publica en loopback por Compose.
    uvicorn.run(create_app(load_settings()), host='0.0.0.0', port=8000, access_log=False, log_level='warning')

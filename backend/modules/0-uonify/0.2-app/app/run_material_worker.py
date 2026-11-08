"""Independent local worker; the API only commits queue requests."""
import logging
import signal
from threading import Event
from uuid import uuid4
from .settings import load_settings
from .database import Database
from .google_drive_provider import GoogleDriveProvider
from .google_cloud_provider import GoogleCloudProvider
from .product_materials import ProductMaterials
from .product_materials_adk import pilot_adapter
from .product_materials_queue import LeaseLost
from .product_requirements import ProductRequirements
from .product_reasoning import ProductReasoning


def claim_next(reasoning_queue, materials_queue, worker_id, prefer_reasoning):
    """Alternate successful claims so either busy queue gets worker time."""
    queues = (('reasoning', reasoning_queue), ('materials', materials_queue))
    if not prefer_reasoning:
        queues = tuple(reversed(queues))
    for kind, queue in queues:
        row = queue.claim(worker_id)
        if row:
            return kind, row, kind == 'materials'
    return None, None, prefer_reasoning


def main():
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(message)s')
    settings = load_settings()
    database = Database(settings.database)
    database.migrate()
    service = ProductMaterials(settings, database, GoogleDriveProvider(settings), GoogleCloudProvider(settings),
                               adk_analyzer=pilot_adapter(settings))
    requirements = ProductRequirements(settings, database)
    reasoning = ProductReasoning(settings, database, service, requirements)
    requirements.reasoning = reasoning
    worker_id, stop = 'materials-' + uuid4().hex, Event()
    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    signal.signal(signal.SIGINT, lambda *_: stop.set())
    prefer_reasoning = True
    while not stop.is_set():
        try:
            kind, row, prefer_reasoning = claim_next(
                reasoning.queue, service.queue, worker_id, prefer_reasoning)
            if kind == 'reasoning':
                reasoning.run(row)
            elif kind == 'materials':
                service.run(row['id'], row['user_id'], row['lease_token'])
            else:
                stop.wait(2)
        except LeaseLost:
            logging.info('Material worker stopped after losing its lease')
        except Exception as error:
            # No credentials, model responses or customer documents in logs.
            logging.error('Material worker failure: %s', type(error).__name__)
            stop.wait(3)


if __name__ == '__main__':
    main()

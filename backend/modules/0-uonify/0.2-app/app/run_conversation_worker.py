"""Separate durable chat worker; the HTTP server only accepts work."""
import logging
import signal
import time
from threading import Event
from uuid import uuid4
from .settings import load_settings
from .database import Database
from .google_cloud_provider import GoogleCloudProvider
from .google_drive_provider import GoogleDriveProvider
from .uony_engine import EngineProviders, enabled_engines
from .uony_queue_health import WorkerMonitor
from .uony_conversation_worker import ConversationWorker
from .uony_drive_scope import purge_expired
from .product_materials import ProductMaterials
from .product_materials_adk import pilot_adapter
from .product_requirements import ProductRequirements
from .product_reasoning import ProductReasoning
from .amazon_incidents_service import AmazonIncidents
from .amazon_provider import AmazonProvider


def main():
    logging.basicConfig(level=logging.INFO,format='%(asctime)s %(message)s')
    settings=load_settings()
    database=Database(settings.database)
    database.migrate()
    cloud=GoogleCloudProvider(settings)
    materials=ProductMaterials(settings,database,GoogleDriveProvider(settings),cloud,
                               adk_analyzer=pilot_adapter(settings))
    requirements=ProductRequirements(settings,database,AmazonProvider(settings).config)
    requirements.reasoning=ProductReasoning(settings,database,materials,requirements)
    incidents=AmazonIncidents(settings,database,AmazonProvider(settings).config)
    worker=ConversationWorker(settings,database,cloud,EngineProviders(settings),incidents,requirements,materials)
    stop=Event();worker_id='conversation-'+uuid4().hex
    signal.signal(signal.SIGTERM,lambda *_:stop.set())
    signal.signal(signal.SIGINT,lambda *_:stop.set())
    monitor=WorkerMonitor(database,worker_id,enabled_engines(settings),
                          policy=worker.queue.recovery_policy)
    purged_at=0.0
    with monitor.running():
        while not stop.is_set():
            try:
                # Scheduled cleanup of expired Drive scopes (audit F0.1, 2a).
                if time.monotonic()-purged_at>600:
                    purge_expired(database);purged_at=time.monotonic()
                job=worker.queue.claim(worker_id)
                if job:
                    monitor.state('running')
                    try:
                        worker.run(job)
                    finally:
                        monitor.state('idle')
                elif not worker.queue.recover_many():
                    stop.wait(1)
            except Exception as exc:
                logging.error('Conversation worker failure: %s',type(exc).__name__)
                stop.wait(3)



if __name__=='__main__':
    main()

from .products import routes as product_routes
from .product_preparation import routes as preparation_routes
from .brands import routes as brand_routes
from .product_requirements import ProductRequirements
from .product_requirements_routes import routes as requirements_routes
from .amazon_publish_snapshots import routes as amazon_publish_snapshot_routes
from .amazon_publish_ledger import routes as amazon_publish_approval_routes
from .amazon_publish_followup import routes as amazon_publish_followup_routes
from .uony_projects import routes as project_routes
from contextlib import asynccontextmanager
import psycopg
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.middleware.trustedhost import TrustedHostMiddleware
from .uony_routes import routes as uony_routes
from .uony_engine import EngineProviders, selected_engine
from .auth import routes
from .onboarding import routes as onboarding_routes
from .onboarding_setup import routes as onboarding_setup_routes
from .onboarding_first_intent import routes as onboarding_first_intent_routes
from .google_setup_routes import routes as google_setup_routes
from .access import routes as access_routes
from .subscription import routes as subscription_routes
from .database import Database
from .stripe_provider import StripeProvider
from .billing_checkout import routes as checkout_routes
from .google import GoogleProvider
from .google_cloud_provider import GoogleCloudProvider
from .google_drive_provider import GoogleDriveProvider
from .google_drive_oauth import routes as drive_oauth_routes
from .google_drive_routes import routes as drive_routes
from .google_cloud_routes import routes as cloud_routes
from .amazon_provider import AmazonProvider
from .amazon_routes import routes as amazon_routes
from .amazon_incidents_service import AmazonIncidents
from .amazon_incidents_routes import routes as incident_routes
from .blender_routes import routes as blender_routes
from .blender_agent import routes as blender_agent_routes
from .blender_metrics import BlenderMetricsMiddleware
from .product_materials import ProductMaterials
from .product_materials_adk import pilot_adapter
from .product_materials_routes import routes as material_routes
from .product_reasoning import ProductReasoning
from .account_deletion import routes as account_deletion_routes
from .google_billing_sync_routes import routes as google_billing_sync_routes
from .product_intake_routes import routes as product_intake_routes
from .uony_conversation_worker import ConversationWorker
from .uony_live_bridge import routes as uony_live_routes
from .uony_live_vertex import VertexLiveProvider
from .uony_live_adk_session import AdkLiveProvider
from .uony_live_gateway import UonyLiveGateway
from .creative_generation_routes import routes as creative_generation_routes
from .creative_preparation_routes import routes as creative_preparation_routes
from .creative_clips_only_upload_route import routes as clips_only_upload_routes
from .creative_clips_only_preview_route import routes as clips_only_preview_routes
from .creative_clips_only_confirmation_route import routes as clips_only_confirmation_routes
from .creative_clips_only_quote_route import routes as clips_only_quote_routes
from .uony_monitoring_routes import routes as uony_monitoring_routes
from .admin_auth import routes as admin_auth_routes


def create_app(settings, provider=None, stripe=None, cloud=None, drive=None, uony=None, amazon=None, incidents=None, requirements=None, materials=None, billing_reports=None, live=None):
    database = Database(settings.database)
    stripe = stripe or StripeProvider(settings)

    @asynccontextmanager
    async def lifespan(app):
        database.migrate()
        yield

    app = FastAPI(title='Uonify · API local', lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=['127.0.0.1', 'localhost', 'api'])
    app.add_middleware(BlenderMetricsMiddleware,database=database)
    cloud = cloud or GoogleCloudProvider(settings)
    # Live is admitted only by the server-side, account-scoped pilot list.
    # Test injection remains explicit; an empty list never opens Vertex.
    # ADK-FLUJOS §11: accounts listed for ADK use that route; the others raw.
    live_provider = AdkLiveProvider if settings.live_adk_user_ids else VertexLiveProvider
    live = live if live is not None else (
        (UonyLiveGateway(settings, database, cloud) if settings.live_gateway_user_ids
         else live_provider(settings, database, cloud, caption_enabled=True))
        if settings.live_pilot_user_ids else None)
    drive = drive or GoogleDriveProvider(settings)
    materials = materials or ProductMaterials(settings,database,drive,cloud,
                                             adk_analyzer=pilot_adapter(settings))
    app.state.materials = materials
    app.include_router(account_deletion_routes(settings, database, stripe, materials))
    amazon = amazon or AmazonProvider(settings)
    incidents = incidents or AmazonIncidents(settings, database, amazon.config)
    requirements = requirements or ProductRequirements(settings, database, amazon.config)
    if isinstance(requirements, ProductRequirements):
        requirements.reasoning = ProductReasoning(settings, database, materials, requirements)
    app.state.requirements = requirements
    app.state.reasoning = getattr(requirements, 'reasoning', None)
    engines=EngineProviders(settings,{selected_engine(settings):uony} if uony is not None else None)
    uony_provider=engines.get(engines.selected_engine)
    app.state.conversation_worker=ConversationWorker(settings,database,cloud,engines,incidents,requirements,materials)
    app.include_router(uony_routes(settings,database,cloud,uony_provider,incidents=incidents,requirements=requirements,materials=materials,live=live))
    app.include_router(uony_live_routes(settings, database, live))
    app.include_router(uony_monitoring_routes(database))
    app.include_router(creative_generation_routes(settings, database))
    app.include_router(creative_preparation_routes(database))
    app.include_router(clips_only_upload_routes(settings, database, cloud))
    app.include_router(clips_only_preview_routes(settings, database, cloud, drive))
    app.include_router(clips_only_confirmation_routes(settings, database))
    app.include_router(clips_only_quote_routes(settings, database))
    app.include_router(google_billing_sync_routes(settings, database, cloud, billing_reports))
    app.include_router(product_intake_routes(settings, database, drive))
    app.include_router(material_routes(settings,database,materials))
    app.include_router(requirements_routes(settings,database,requirements))
    app.include_router(amazon_publish_snapshot_routes(settings,database))
    app.include_router(amazon_publish_approval_routes(settings,database))
    app.include_router(amazon_publish_followup_routes(database))
    app.include_router(project_routes(settings,database))
    app.include_router(product_routes(settings,database))
    app.include_router(brand_routes(settings,database))
    app.include_router(preparation_routes(settings,database))
    app.include_router(blender_routes(settings,database))
    app.include_router(blender_agent_routes(database))
    cloud_router, cloud_callback = cloud_routes(settings, database, cloud)
    drive_router, drive_callback = drive_oauth_routes(settings, database, drive)
    app.include_router(drive_router)
    app.include_router(drive_routes(settings, database, drive))
    app.include_router(cloud_router)
    app.include_router(google_setup_routes(settings, database, cloud))
    app.include_router(amazon_routes(settings, database, amazon))
    app.include_router(incident_routes(settings, database, amazon, incidents=incidents))
    app.include_router(routes(settings, database, provider or GoogleProvider(settings), cloud_callback, drive_callback))
    app.include_router(onboarding_routes(settings, database))
    app.include_router(onboarding_setup_routes(settings, database))
    app.include_router(onboarding_first_intent_routes(settings, database))
    app.include_router(access_routes(database))
    app.include_router(subscription_routes(settings, database, stripe))

    app.include_router(checkout_routes(settings, database, stripe))
    app.include_router(admin_auth_routes(settings, database))

    @app.middleware('http')
    async def private_responses(request: Request, call_next):
        length = request.headers.get('content-length', '0')
        preparation_path = request.url.path.startswith('/api/products/') and request.url.path.endswith('/preparation')
        limit = 1572864 if request.url.path == '/api/blender-agent/report' else 20 * 1024 * 1024 if request.url.path == '/api/connections/google-drive/upload' else 20 * 1024 * 1024 if (request.url.path.startswith('/api/uony/threads/') and request.url.path.endswith('/estudio/uploads')) else 131072 if request.url.path in ('/api/billing/stripe/webhook', '/api/uony/messages') or preparation_path else 65536 if request.url.path.startswith('/api/products') else 8192
        if not length.isdigit() or int(length) > limit:
            return JSONResponse({'error': 'body_too_large', 'message': 'Petición demasiado grande.'}, status_code=413)
        response = await call_next(request)
        response.headers['Cache-Control'] = 'no-store'
        response.headers['Referrer-Policy'] = 'no-referrer'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['X-Frame-Options'] = 'DENY'
        return response

    @app.exception_handler(HTTPException)
    async def http_error(request, error):
        body = error.detail if isinstance(error.detail, dict) else {'error': 'request_error', 'message': 'No se pudo completar la petición.'}
        return JSONResponse(body, status_code=error.status_code)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, error):
        return JSONResponse({'error': 'invalid_request', 'message': 'Revisa los datos enviados.'}, status_code=400)

    @app.exception_handler(psycopg.Error)
    async def database_error(request, error):
        return JSONResponse({'error': 'database_unavailable', 'message': 'No podemos recuperar tu cuenta ahora. Inténtalo de nuevo.'}, status_code=503)

    @app.get('/api/health')
    def health():
        with database.connect() as connection:
            connection.execute('SELECT 1')
        return {'status': 'ok', 'database': 'ok'}

    return app

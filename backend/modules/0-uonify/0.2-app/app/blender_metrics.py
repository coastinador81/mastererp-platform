"""Cuenta bytes HTTP observados y tiempo de coordinación; no supone una tarifa."""
from time import perf_counter
from starlette.concurrency import run_in_threadpool
import psycopg


def record(database,user_id,operation,request_bytes,response_bytes,duration_ms):
    with database.connect() as connection:
        connection.execute('''INSERT INTO blender_coordination_usage
            (user_id,operation,request_bytes,response_bytes,backend_duration_ms) VALUES(%s,%s,%s,%s,%s)''',
            (user_id,operation,request_bytes,response_bytes,duration_ms))


class BlenderMetricsMiddleware:
    def __init__(self,app,database):
        self.app=app;self.database=database

    async def __call__(self,scope,receive,send):
        path=scope.get('path','')
        if scope['type']!='http' or not path.startswith(('/api/connections/blender-local','/api/blender-agent/')):
            return await self.app(scope,receive,send)
        received=sent=0;started=perf_counter()
        async def measured_receive():
            nonlocal received
            message=await receive()
            if message['type']=='http.request':received+=len(message.get('body',b''))
            return message
        async def measured_send(message):
            nonlocal sent
            if message['type']=='http.response.body':sent+=len(message.get('body',b''))
            await send(message)
        try:
            await self.app(scope,measured_receive,measured_send)
        finally:
            user_id=scope.get('state',{}).get('blender_user_id')
            if user_id:
                duration=round((perf_counter()-started)*1000)
                # No convierte un resultado entregado en error; ausencia de medida no equivale a cero coste.
                try:
                    await run_in_threadpool(record,self.database,user_id,scope['method']+' '+path,received,sent,duration)
                except psycopg.Error:
                    pass

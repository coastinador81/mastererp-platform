FROM public.ecr.aws/docker/library/python:3.12-slim

WORKDIR /app
COPY mastererp-platform/services/core-api/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY mastererp-platform/services/core-api/server.py mastererp-platform/services/core-api/migrate.py ./
COPY mastererp-database/schema/002_operacion.sql ./sql/002_operacion.sql

EXPOSE 8080
CMD ["python", "server.py"]

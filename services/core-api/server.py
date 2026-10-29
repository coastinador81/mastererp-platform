import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import boto3
import psycopg
from psycopg.rows import dict_row

PORT = 8080
MODULOS_INICIALES = ("2.1", "2.1.6", "2.4.1", "2.7.1")
_secret = None


class HttpError(Exception):
    def __init__(self, status, message):
        self.status = status
        self.message = message


def mode():
    return os.environ.get("SERVICE_MODE", "admin")


def secret():
    global _secret
    if _secret is None:
        raw = boto3.client("secretsmanager", region_name=os.environ.get("AWS_REGION", "us-west-2")).get_secret_value(
            SecretId=os.environ["DATABASE_SECRET_ARN"]
        )
        _secret = json.loads(raw["SecretString"])
    return _secret


def connect():
    creds = secret()
    return psycopg.connect(
        host=os.environ["DATABASE_HOST"],
        port=5432,
        dbname=os.environ.get("DATABASE_NAME", "mastererp"),
        user=creds["username"],
        password=creds["password"],
        sslmode="require",
        connect_timeout=5,
        row_factory=dict_row,
    )


def require_module(conn, organizacion_id, codigo):
    row = conn.execute(
        "SELECT activo FROM plataforma.modulos WHERE organizacion_id = %s AND codigo = %s",
        (organizacion_id, codigo),
    ).fetchone()
    if not row or not row["activo"]:
        raise HttpError(409, f"El modulo {codigo} no esta activo para esta organizacion")


def body_of(handler):
    length = int(handler.headers.get("Content-Length", "0"))
    if length == 0:
        return {}
    raw = handler.rfile.read(length)
    try:
        data = json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise HttpError(400, "El cuerpo tiene que ser JSON") from exc
    if not isinstance(data, dict):
        raise HttpError(400, "El cuerpo tiene que ser un objeto")
    return data


def need(data, *fields):
    missing = [field for field in fields if not str(data.get(field, "")).strip()]
    if missing:
        raise HttpError(400, "Faltan campos: " + ", ".join(missing))


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        print("%s - %s" % (self.address_string(), fmt % args))

    def do_OPTIONS(self):
        self.respond(204, {})

    def do_GET(self):
        self.dispatch("GET")

    def do_POST(self):
        self.dispatch("POST")

    def dispatch(self, method):
        path = self.path.split("?", 1)[0]
        query = {}
        if "?" in self.path:
            for part in self.path.split("?", 1)[1].split("&"):
                if "=" in part:
                    key, value = part.split("=", 1)
                    query[key] = value
        try:
            payload = self.route(method, path, query)
            self.respond(200, payload)
        except HttpError as exc:
            self.respond(exc.status, {"error": exc.message})
        except psycopg.errors.UniqueViolation:
            self.respond(409, {"error": "Ese dato ya existe"})
        except ValueError:
            self.respond(400, {"error": "Un numero del formulario no es valido"})
        except Exception as exc:
            print("error", exc)
            self.respond(500, {"error": "No se pudo completar la operacion"})

    def route(self, method, path, query):
        if method == "GET" and path == "/":
            return {"ok": True, "service": mode()}
        if mode() == "client":
            return self.client(method, path, query)
        if mode() in ("agents", "mcp"):
            return self.agents(method, path)
        return self.admin(method, path, query)

    def admin(self, method, path, query):
        if method == "POST" and path == "/v1/organizaciones":
            return self.crear_organizacion()
        if method == "GET" and path == "/v1/organizaciones":
            return self.listar_organizaciones()
        if method == "POST" and path == "/v1/productos":
            return self.crear_producto()
        if method == "GET" and path == "/v1/productos":
            return self.listar_productos(query.get("organizacion_id", ""))
        if method == "POST" and path == "/v1/inventario":
            return self.guardar_inventario()
        if method == "POST" and path == "/v1/paginas":
            return self.guardar_pagina()
        if method == "POST" and path == "/v1/empleados":
            return self.crear_empleado()
        if method == "GET" and path == "/v1/empleados":
            return self.listar_empleados(query.get("organizacion_id", ""))
        if method == "POST" and path == "/v1/usuarios":
            return self.crear_usuario()
        raise HttpError(404, "Ruta no encontrada")

    def client(self, method, path, query):
        if method == "GET" and path == "/v1/tienda":
            return self.tienda(query.get("host", ""))
        raise HttpError(404, "Ruta no encontrada")

    def agents(self, method, path):
        if method == "POST" and path == "/v1/flujos":
            data = body_of(self)
            need(data, "mensaje")
            return {"estado": "recibido", "mensaje": data["mensaje"], "servicio": mode()}
        raise HttpError(404, "Ruta no encontrada")

    def crear_organizacion(self):
        data = body_of(self)
        need(data, "nombre", "slug")
        codigos = data.get("modulos") or list(MODULOS_INICIALES)
        with connect() as conn:
            org = conn.execute(
                "INSERT INTO plataforma.organizaciones (nombre, slug) VALUES (%s, %s) RETURNING id, nombre, slug",
                (data["nombre"].strip(), data["slug"].strip().lower()),
            ).fetchone()
            for codigo in codigos:
                conn.execute(
                    "INSERT INTO plataforma.modulos (organizacion_id, codigo, activo) VALUES (%s, %s, true)",
                    (org["id"], str(codigo)),
                )
            conn.commit()
        org["id"] = str(org["id"])
        org["modulos"] = [str(codigo) for codigo in codigos]
        return org

    def listar_organizaciones(self):
        with connect() as conn:
            rows = conn.execute(
                "SELECT id, nombre, slug FROM plataforma.organizaciones ORDER BY creado_en"
            ).fetchall()
        for row in rows:
            row["id"] = str(row["id"])
        return {"organizaciones": rows}

    def crear_producto(self):
        data = body_of(self)
        need(data, "organizacion_id", "sku", "nombre", "precio_centavos")
        with connect() as conn:
            require_module(conn, data["organizacion_id"], "2.1")
            row = conn.execute(
                """
                INSERT INTO catalogo.productos (organizacion_id, sku, nombre, precio_centavos, categoria)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING id, sku, nombre, precio_centavos, categoria
                """,
                (
                    data["organizacion_id"],
                    data["sku"].strip(),
                    data["nombre"].strip(),
                    int(data["precio_centavos"]),
                    str(data.get("categoria", "")).strip(),
                ),
            ).fetchone()
            conn.commit()
        row["id"] = str(row["id"])
        return row

    def listar_productos(self, organizacion_id):
        if not organizacion_id:
            raise HttpError(400, "Falta organizacion_id")
        with connect() as conn:
            rows = conn.execute(
                """
                SELECT p.sku, p.nombre, p.precio_centavos, p.categoria, COALESCE(i.cantidad, 0) AS cantidad
                FROM catalogo.productos p
                LEFT JOIN catalogo.inventario i ON i.organizacion_id = p.organizacion_id AND i.sku = p.sku
                WHERE p.organizacion_id = %s
                ORDER BY p.nombre
                """,
                (organizacion_id,),
            ).fetchall()
        return {"productos": rows}

    def guardar_inventario(self):
        data = body_of(self)
        need(data, "organizacion_id", "sku", "cantidad")
        with connect() as conn:
            require_module(conn, data["organizacion_id"], "2.1.6")
            conn.execute(
                """
                INSERT INTO catalogo.inventario (organizacion_id, sku, cantidad)
                VALUES (%s, %s, %s)
                ON CONFLICT (organizacion_id, sku) DO UPDATE SET cantidad = EXCLUDED.cantidad
                """,
                (data["organizacion_id"], data["sku"].strip(), int(data["cantidad"])),
            )
            conn.commit()
        return {"sku": data["sku"].strip(), "cantidad": int(data["cantidad"])}

    def guardar_pagina(self):
        data = body_of(self)
        need(data, "organizacion_id", "host")
        host = data["host"].strip().lower()
        with connect() as conn:
            require_module(conn, data["organizacion_id"], "2.4.1")
            row = conn.execute(
                """
                INSERT INTO comercio.paginas (organizacion_id, host)
                VALUES (%s, %s)
                ON CONFLICT (organizacion_id) DO UPDATE SET host = EXCLUDED.host
                RETURNING host
                """,
                (data["organizacion_id"], host),
            ).fetchone()
            conn.commit()
        return row

    def crear_empleado(self):
        data = body_of(self)
        need(data, "organizacion_id", "nombre", "puesto")
        with connect() as conn:
            require_module(conn, data["organizacion_id"], "2.7.1")
            row = conn.execute(
                """
                INSERT INTO personas.empleados (organizacion_id, nombre, puesto, sucursal)
                VALUES (%s, %s, %s, %s)
                RETURNING id, nombre, puesto, sucursal
                """,
                (
                    data["organizacion_id"],
                    data["nombre"].strip(),
                    data["puesto"].strip(),
                    str(data.get("sucursal", "")).strip(),
                ),
            ).fetchone()
            conn.commit()
        row["id"] = str(row["id"])
        return row

    def listar_empleados(self, organizacion_id):
        if not organizacion_id:
            raise HttpError(400, "Falta organizacion_id")
        with connect() as conn:
            rows = conn.execute(
                "SELECT id, nombre, puesto, sucursal FROM personas.empleados WHERE organizacion_id = %s ORDER BY nombre",
                (organizacion_id,),
            ).fetchall()
        for row in rows:
            row["id"] = str(row["id"])
        return {"empleados": rows}

    def crear_usuario(self):
        data = body_of(self)
        need(data, "organizacion_id", "nombre", "correo", "rol")
        with connect() as conn:
            row = conn.execute(
                """
                INSERT INTO plataforma.usuarios (organizacion_id, nombre, correo, rol)
                VALUES (%s, %s, %s, %s)
                RETURNING id, nombre, correo, rol
                """,
                (data["organizacion_id"], data["nombre"].strip(), data["correo"].strip().lower(), data["rol"].strip()),
            ).fetchone()
            conn.commit()
        row["id"] = str(row["id"])
        return row

    def tienda(self, host):
        if not host:
            raise HttpError(400, "Falta host")
        with connect() as conn:
            page = conn.execute(
                "SELECT organizacion_id, host FROM comercio.paginas WHERE host = %s",
                (host.strip().lower(),),
            ).fetchone()
            if not page:
                raise HttpError(404, "Esta pagina no esta publicada")
            org = conn.execute(
                "SELECT nombre, slug FROM plataforma.organizaciones WHERE id = %s",
                (page["organizacion_id"],),
            ).fetchone()
            productos = conn.execute(
                """
                SELECT p.sku, p.nombre, p.precio_centavos, p.categoria, COALESCE(i.cantidad, 0) AS cantidad
                FROM catalogo.productos p
                LEFT JOIN catalogo.inventario i ON i.organizacion_id = p.organizacion_id AND i.sku = p.sku
                WHERE p.organizacion_id = %s
                ORDER BY p.nombre
                """,
                (page["organizacion_id"],),
            ).fetchall()
        return {"organizacion": org["nombre"], "slug": org["slug"], "host": page["host"], "productos": productos}

    def respond(self, status, payload):
        raw = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "content-type")
        self.end_headers()
        self.wfile.write(raw)


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()

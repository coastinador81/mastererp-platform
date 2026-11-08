"""Cliente HTTP de solo lectura para el preflight creativo Google."""

import re
from urllib.parse import quote

import requests


_PROJECT = re.compile(r"[a-z][a-z0-9-]{4,61}[a-z0-9]\Z")
_RESOURCE = re.compile(r"projects/[0-9]{1,30}\Z")
_SERVICES = frozenset({
    "aiplatform.googleapis.com", "storage.googleapis.com",
    "texttospeech.googleapis.com", "transcoder.googleapis.com",
})
_PERMISSIONS = frozenset({
    "aiplatform.endpoints.predict", "serviceusage.services.use",
    "transcoder.jobs.create", "transcoder.jobs.get",
})


class GoogleCreativePreflightError(RuntimeError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


class GoogleCreativeHttpClient:
    """Hace una llamada acotada por comprobación; no genera ni reintenta."""

    def __init__(self, session: requests.Session):
        if not callable(getattr(session, "request", None)):
            raise ValueError("Sesión HTTP Google no válida.")
        self.session = session

    def _request(self, token: str, method: str, url: str, body=None) -> dict:
        if not isinstance(token, str) or not token:
            raise ValueError("Autorización Google ausente.")
        try:
            response = self.session.request(
                method, url,
                headers={"Authorization": "Bearer " + token,
                         "Content-Type": "application/json"},
                json=body, timeout=(10, 20), allow_redirects=False)
        except requests.RequestException as error:
            network_error = type(error).__name__
        else:
            network_error = None
        if network_error is not None:
            # H4: la RequestException lleva el Bearer en .request; se relanza
            # fuera del except conservando solo el nombre de la clase.
            failure = GoogleCreativePreflightError("google_unavailable")
            failure.cause_class = network_error
            raise failure from None
        try:
            if response.status_code == 401:
                raise GoogleCreativePreflightError("reauthorize")
            if response.status_code == 403:
                raise GoogleCreativePreflightError("permission_denied")
            if response.status_code >= 500:
                raise GoogleCreativePreflightError("google_unavailable")
            if response.status_code != 200:
                raise GoogleCreativePreflightError("invalid_response")
            try:
                payload = response.json()
            except (ValueError, requests.RequestException) as error:
                raise GoogleCreativePreflightError("invalid_response") from error
            if not isinstance(payload, dict):
                raise GoogleCreativePreflightError("invalid_response")
            return payload
        finally:
            response.close()

    def project(self, token: str, project: str) -> dict | None:
        if not isinstance(project, str) or not _PROJECT.fullmatch(project):
            raise ValueError("Proyecto Google no válido.")
        data = self._request(
            token, "GET",
            f"https://cloudresourcemanager.googleapis.com/v3/projects/{project}")
        if (data.get("projectId") != project or data.get("state") != "ACTIVE"
                or not isinstance(data.get("name"), str)
                or not _RESOURCE.fullmatch(data["name"])):
            raise GoogleCreativePreflightError("invalid_response")
        return {"id": project, "resource": data["name"]}

    def billing_info(self, token: str, project: str) -> dict:
        if not isinstance(project, str) or not _PROJECT.fullmatch(project):
            raise ValueError("Proyecto Google no válido.")
        data = self._request(
            token, "GET",
            f"https://cloudbilling.googleapis.com/v1/projects/{project}/billingInfo")
        return {"enabled": data.get("billingEnabled") is True}

    def service_state(self, token: str, resource: str, service: str) -> str:
        if (not isinstance(resource, str) or not _RESOURCE.fullmatch(resource)
                or service not in _SERVICES):
            raise ValueError("Servicio Google no válido.")
        name = f"{resource}/services/{service}"
        data = self._request(
            token, "GET", f"https://serviceusage.googleapis.com/v1/{name}")
        if data.get("name") != name or data.get("state") not in (
                "ENABLED", "DISABLED"):
            raise GoogleCreativePreflightError("invalid_response")
        return data["state"]

    def permissions(self, token: str, project: str,
                    requested: tuple[str, ...]) -> tuple[str, ...]:
        if (not isinstance(project, str) or not _PROJECT.fullmatch(project)
                or not isinstance(requested, tuple) or not requested
                or len(requested) != len(set(requested))
                or any(value not in _PERMISSIONS for value in requested)):
            raise ValueError("Permisos Google no válidos.")
        data = self._request(
            token, "POST",
            f"https://cloudresourcemanager.googleapis.com/v1/projects/{project}"
            ":testIamPermissions", {"permissions": list(requested)})
        granted = data.get("permissions", [])
        if (not isinstance(granted, list)
                or any(value not in requested for value in granted)
                or len(granted) != len(set(granted))):
            raise GoogleCreativePreflightError("invalid_response")
        return tuple(granted)


def bucket_create_permission(session: requests.Session, token: str,
                             bucket: str) -> None:
    """H13: comprueba (testIamPermissions, sonda de SOLO LECTURA) que la credencial tiene
    storage.objects.create sobre el bucket de SALIDA, ANTES de abrir Veo durable.
    fail-closed con ValueError si no está concedido, si la respuesta no es verificable o
    si la red falla. El GET lleva Bearer: patrón H4 (se relanza fuera del except sin dejar
    el token en la cadena) + allow_redirects=False (H9)."""
    if not isinstance(token, str) or not token:
        raise ValueError("Autorización Cloud Storage ausente.")
    if not isinstance(bucket, str) or not bucket:
        raise ValueError("Bucket de salida no válido.")
    url = (f"https://storage.googleapis.com/storage/v1/b/{quote(bucket, safe='')}"
           f"/iam/testPermissions?permissions=storage.objects.create")
    network_error = None
    response = None
    try:
        response = session.request(
            "GET", url, headers={"Authorization": "Bearer " + token},
            timeout=(10, 20), allow_redirects=False)
    except requests.RequestException as error:
        network_error = type(error).__name__
    if network_error is not None:
        failure = ValueError(
            "No se pudo comprobar el permiso de escritura del bucket de salida.")
        failure.cause_class = network_error
        raise failure from None
    try:
        if response.status_code != 200:
            raise ValueError(
                "No se pudo comprobar el permiso de escritura del bucket de salida.")
        try:
            payload = response.json()
        except (ValueError, requests.RequestException):
            raise ValueError(
                "Respuesta de permisos del bucket de salida ilegible.") from None
    finally:
        if response is not None:
            response.close()
    granted = payload.get("permissions") if isinstance(payload, dict) else None
    if not isinstance(granted, list) or "storage.objects.create" not in granted:
        raise ValueError(
            "Falta storage.objects.create en el bucket de salida; no se abre Veo durable.")

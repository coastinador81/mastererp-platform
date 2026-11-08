"""Inactive bridge from a fenced creative claim to Craft Launcher V2.

The bridge deliberately has no adapter from ``CraftRuntimeRequest`` V1.  Every
V2 request is reconstructed by the PostgreSQL resolver from the complete
``CreativeAttemptClaim`` and durable Craft authority.  It is not registered in
the runner, API startup or any route.
"""

from dataclasses import dataclass
from typing import Protocol

from .creative_craft_launcher_contract import (
    CraftLauncherContractError, CraftLauncherRequest,
)
from .creative_execution_coordinator import (
    CreativeAttemptClaim, checkpoint_provider_started,
)


class CraftLauncherV2Transport(Protocol):
    def reserve(self, request: CraftLauncherRequest) -> dict: ...
    def dispatch(self, request: CraftLauncherRequest) -> dict: ...
    def status(self, request: CraftLauncherRequest) -> dict: ...
    def cancel(self, request: CraftLauncherRequest) -> dict: ...
    def acknowledge(self, request: CraftLauncherRequest) -> dict: ...
    def compensate_prestart(self, request: CraftLauncherRequest) -> dict: ...


@dataclass(frozen=True)
class CraftLauncherReservation:
    dispatch_id: str
    request_sha256: str
    authority_sha256: str
    profile_sha256: str
    status: str


def _claim(value: object) -> CreativeAttemptClaim:
    if (not isinstance(value, CreativeAttemptClaim) or value.kind != "craft"
            or not value.provider_call or value.execution_authorized
            or value.publication_authorized):
        raise CraftLauncherContractError(
            "El puente V2 requiere el claim Craft privado completo.")
    return value


def _exact_response(
        request: CraftLauncherRequest, value: object,
        statuses: frozenset[str], *, required: frozenset[str] = frozenset(),
        optional: frozenset[str] = frozenset()) -> dict:
    base = frozenset({"schemaVersion", "dispatchId", "requestSha256", "status"})
    allowed = base | required | optional
    if (not isinstance(value, dict)
            or not (base | required).issubset(value)
            or not set(value) <= allowed
            or value.get("schemaVersion") != 1):
        raise CraftLauncherContractError(
            "El launcher V2 no devolvió un recibo cerrado.")
    if (value.get("dispatchId") != request.body["dispatchId"]
            or value.get("requestSha256") != request.request_sha256
            or value.get("status") not in statuses):
        raise CraftLauncherContractError(
            "El recibo del launcher V2 no coincide con su fence.")
    return value


class CraftLauncherV2ExecutionPort:
    """Orchestrates V2 reserve/start/recovery without accepting V1 authority.

    ``database`` is retained explicitly so construction cannot hide which
    persistence boundary owns the attempt.  The resolver owns all SQL and
    materialization details; the transport only receives the closed V2 request.
    """

    def __init__(self, database: object, resolver: object,
                 transport: CraftLauncherV2Transport):
        required_resolver = (
            "prepare_start", "record_reservation", "load_reserved_request",
            "authorize_terminal_ack", "record_terminal_ack",
            "release_terminal_ack",
        )
        required_transport = (
            "reserve", "dispatch", "status", "cancel", "acknowledge",
        )
        if (database is None
                or any(not callable(getattr(resolver, name, None))
                       for name in required_resolver)
                or any(not callable(getattr(transport, name, None))
                       for name in required_transport)):
            raise CraftLauncherContractError(
                "El puente V2 no tiene dependencias privadas completas.")
        self.database = database
        self.resolver = resolver
        self.transport = transport

    def reserve_claim(
            self, claim: CreativeAttemptClaim) -> CraftLauncherReservation:
        item = _claim(claim)
        request = self.resolver.prepare_start(item)
        if not isinstance(request, CraftLauncherRequest):
            raise CraftLauncherContractError(
                "El resolver no reconstruyó una petición V2 canónica.")
        response = _exact_response(
            request, self.transport.reserve(request),
            frozenset({"reserved"}),
            required=frozenset({"authoritySha256", "profileSha256"}),
        )
        for key in ("authoritySha256", "profileSha256"):
            value = response.get(key)
            if (not isinstance(value, str) or len(value) != 64
                    or any(char not in "0123456789abcdef" for char in value)):
                raise CraftLauncherContractError(
                    "La reserva V2 no liga su autoridad exacta.")
        self.resolver.record_reservation(item, request, response)
        return CraftLauncherReservation(
            request.body["dispatchId"], request.request_sha256,
            response["authoritySha256"], response["profileSha256"],
            response["status"],
        )

    def dispatch_claim(self, claim: CreativeAttemptClaim) -> dict:
        item = _claim(claim)
        request = self.resolver.load_reserved_request(item)
        if not isinstance(request, CraftLauncherRequest):
            raise CraftLauncherContractError(
                "El intento no conserva una reserva V2 exacta.")
        response = _exact_response(
            request, self.transport.dispatch(request),
            frozenset({"succeeded", "failed", "cancelled"}),
            optional=frozenset({
                "outputs", "outputManifestSha256", "usage", "cleanup",
                "errorCode",
            }),
        )
        return response

    def checkpoint_claim(self, settings: object,
                         claim: CreativeAttemptClaim) -> None:
        """Commit provider-start only after the exact reserve receipt exists."""
        item = _claim(claim)
        request = self.resolver.load_reserved_request(item)
        if not isinstance(request, CraftLauncherRequest):
            raise CraftLauncherContractError(
                "El intento no conserva una reserva V2 exacta.")
        checkpoint_provider_started(
            self.database, settings, item,
            craft_launcher_request_sha256=request.request_sha256,
        )

    def compensate_unconfirmed_claim(self, claim: CreativeAttemptClaim) -> dict:
        """Clean an unconfirmed preparation without holding PostgreSQL locks."""
        item = _claim(claim)
        acquire = getattr(self.resolver, "claim_prestart_compensation", None)
        complete = getattr(self.resolver, "complete_prestart_compensation", None)
        release = getattr(self.resolver, "release_prestart_compensation", None)
        compensate = getattr(self.transport, "compensate_prestart", None)
        if not all(callable(value) for value in (
                acquire, complete, release, compensate)):
            raise CraftLauncherContractError(
                "El puente no tiene compensación pre-start completa.")
        binding = acquire(item)
        prior = getattr(binding, "completed_receipt", None)
        if prior is not None:
            return prior
        request = getattr(binding, "request", None)
        if not isinstance(request, CraftLauncherRequest):
            raise CraftLauncherContractError(
                "La compensación no reconstruyó una petición V2 canónica.")
        try:
            response = _exact_response(
                request, compensate(request), frozenset({"forgotten"}),
                required=frozenset({"cleanup"}),
            )
            if response["cleanup"] != "verified":
                raise CraftLauncherContractError(
                    "La compensación local no verificó su limpieza.")
            if complete(item, binding, response) is False:
                raise CraftLauncherContractError(
                    "La compensación perdió el CAS de su tombstone.")
            return response
        except BaseException as error:
            try:
                release(item, binding, error)
            except BaseException:
                pass
            raise

    def recover_claim(self, claim: CreativeAttemptClaim) -> dict:
        item = _claim(claim)
        request = self.resolver.load_reserved_request(item, recovery=True)
        if not isinstance(request, CraftLauncherRequest):
            raise CraftLauncherContractError(
                "El intento no conserva una reserva recuperable.")
        return _exact_response(
            request, self.transport.status(request),
            frozenset({"reserved", "running", "cleanup_pending", "succeeded",
                       "failed", "cancelled", "forgotten"}),
            optional=frozenset({"cleanup", "terminalReceipt"}),
        )

    def cancel_claim(self, claim: CreativeAttemptClaim) -> dict:
        item = _claim(claim)
        request = self.resolver.load_reserved_request(item, recovery=True)
        if not isinstance(request, CraftLauncherRequest):
            raise CraftLauncherContractError(
                "El intento no conserva una reserva recuperable.")
        return _exact_response(
            request, self.transport.cancel(request),
            frozenset({"cancelled", "already_terminal"}),
            optional=frozenset({"cleanup"}),
        )

    def acknowledge_terminal(self, claim: CreativeAttemptClaim,
                             terminal_status: str,
                             outbox_lease_token: str) -> dict:
        item = _claim(claim)
        request = self.resolver.authorize_terminal_ack(
            item, terminal_status, outbox_lease_token)
        if not isinstance(request, CraftLauncherRequest):
            raise CraftLauncherContractError(
                "El ACK no conserva una autoridad terminal exacta.")
        try:
            response = _exact_response(
                request, self.transport.acknowledge(request),
                frozenset({"forgotten"}),
            )
            recorded = self.resolver.record_terminal_ack(
                item, terminal_status, outbox_lease_token, response)
            if recorded is False:
                raise CraftLauncherContractError(
                    "El ACK perdió el lease durable antes del CAS final.")
            return response
        except BaseException as error:
            try:
                self.resolver.release_terminal_ack(
                    item, terminal_status, outbox_lease_token, error)
            except BaseException:
                pass
            raise

    # These names make accidental use through the legacy CraftExecutionPort
    # fail before any V2 effect.  V1 lacks the complete claim and cannot be an
    # authority source for reserve, dispatch, cancellation or ACK.
    def execute(self, *_args, **_kwargs):
        raise CraftLauncherContractError(
            "Runtime V1 no puede despachar el launcher V2.")

    def cancel(self, *_args, **_kwargs):
        raise CraftLauncherContractError(
            "Runtime V1 no puede cancelar el launcher V2.")

    def reconcile_terminal(self, *_args, **_kwargs):
        raise CraftLauncherContractError(
            "Runtime V1 no puede confirmar el terminal del launcher V2.")

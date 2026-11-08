"""Inactive claim-only orchestrator for the Craft 117 materialization lane.

The only public work item is ``CreativeAttemptClaim``.  Job, adapter, request,
paths, tokens and physical challenges are reconstructed by server-owned
dependencies.  Every SQL call owns a short transaction and no transaction is
held while input bytes or the local filesystem are touched.

This module stops after an attached launcher reservation.  It is not wired to
the runner, worker, startup, provider transport or candidate persistence and
therefore is deliberately not an end-to-end Craft execution path.
"""

from __future__ import annotations

from datetime import datetime
import time
from typing import Callable, Mapping, Protocol
from uuid import UUID

from .creative_craft_launcher_authority import (
    CraftInputBinding, CraftLauncherProfile,
)
from .creative_craft_launcher_contract import (
    CraftLauncherContractError, CraftLauncherRequest,
)
from .creative_craft_launcher_postgres import (
    _control_document, _expected_outputs, _limits,
    _validate_materialized_inputs, CraftLauncherMaterialization,
)
from .creative_craft_materializer import (
    CraftBoundMaterializationPlan, CraftMaterializationIntent,
    CraftMaterializationResult,
)
from .creative_craft_transition_client import (
    CraftTransitionClient, CraftTransitionClientError, transition,
)
from .creative_execution_coordinator import CreativeAttemptClaim


class CraftMaterializationOrchestratorError(CraftLauncherContractError):
    """The inactive 117 lane lost an exact server-owned binding."""


class CraftMaterializationRetry(CraftMaterializationOrchestratorError):
    """Another durable owner still holds the relevant server lease."""


class CraftMaterializationInputSource(Protocol):
    """Private source; callers never supply bindings, paths or bytes."""

    def bindings_for(self, job: object) -> tuple[CraftInputBinding, ...]: ...

    def read_payloads(
        self, job: object, bound: CraftBoundMaterializationPlan, *,
        deadline_monotonic: float, renew: Callable[[], bool],
    ) -> Mapping[str, bytes]: ...


class CraftMaterializationPhysicalVerifier(Protocol):
    installation_id: str
    storage_domain_id: str

    def issue_materialization_populate(
        self, *, user_id: str, attempt_id: str, intent_id: str,
        generation_id: str, lease_token: str,
    ) -> object: ...

    def verify_materialization_populate(
        self, *, challenge: object, plan: dict,
        populate_receipt: dict,
    ) -> str: ...


_SHA_FIELDS = frozenset({
    "populationFenceSha256", "planSha256", "logicalPlanSha256",
    "authoritySha256", "profileSha256",
})


def _claim(value: object) -> CreativeAttemptClaim:
    if (not isinstance(value, CreativeAttemptClaim) or value.kind != "craft"
            or not value.provider_call or value.execution_authorized
            or value.publication_authorized):
        raise CraftMaterializationOrchestratorError(
            "El orquestador 117 exige un claim Craft privado completo.")
    return value


def _uuid(value: object, label: str) -> str:
    try:
        parsed = str(UUID(str(value)))
    except (TypeError, ValueError, AttributeError):
        raise CraftMaterializationOrchestratorError(
            f"{label} no es UUID canónico.") from None
    if value != parsed:
        raise CraftMaterializationOrchestratorError(
            f"{label} no es UUID canónico.")
    return parsed


def _sha(value: object, label: str) -> str:
    if (not isinstance(value, str) or len(value) != 64
            or any(char not in "0123456789abcdef" for char in value)):
        raise CraftMaterializationOrchestratorError(
            f"{label} no es SHA-256 canónico.")
    return value


def _timestamp(value: object, label: str) -> str:
    if not isinstance(value, str) or not value.endswith("Z"):
        raise CraftMaterializationOrchestratorError(
            f"{label} no es timestamp UTC canónico.")
    try:
        datetime.fromisoformat(value[:-1] + "+00:00")
    except ValueError:
        raise CraftMaterializationOrchestratorError(
            f"{label} no es timestamp UTC canónico.") from None
    return value


def _closed(value: object, fields: frozenset[str], label: str) -> dict:
    if not isinstance(value, dict) or set(value) != fields:
        raise CraftMaterializationOrchestratorError(
            f"{label} no es un DTO cerrado.")
    for key in fields & _SHA_FIELDS:
        _sha(value[key], key)
    return value


def _request_document(request: CraftLauncherRequest) -> dict:
    return {"body": request.body, "requestSha256": request.request_sha256}


class CraftMaterializationOrchestrator:
    """Owns begin through attach, while every external integration is off."""

    ready_for_end_to_end = False

    def __init__(
        self, resolver: object, materializer: object,
        input_source: CraftMaterializationInputSource,
        physical_verifier: CraftMaterializationPhysicalVerifier, *,
        timeout_seconds: float = 60.0,
        monotonic: Callable[[], float] = time.monotonic,
    ):
        database = getattr(resolver, "database", None)
        transitions = getattr(resolver, "transitions", None)
        required_materializer = ("plan", "prepare", "populate", "finalize")
        required_source = ("bindings_for", "read_payloads")
        required_physical = (
            "issue_materialization_populate", "verify_materialization_populate")
        if (database is None
                or not callable(getattr(resolver,
                                        "load_materialization_context", None))
                or not isinstance(transitions, CraftTransitionClient)
                or any(not callable(getattr(materializer, name, None))
                       for name in required_materializer)
                or any(not callable(getattr(input_source, name, None))
                       for name in required_source)
                or any(not callable(getattr(physical_verifier, name, None))
                       for name in required_physical)
                or type(timeout_seconds) not in (int, float)
                or not 0 < timeout_seconds <= 60
                or not callable(monotonic)):
            raise CraftMaterializationOrchestratorError(
                "El orquestador 117 no tiene dependencias privadas completas.")
        if (physical_verifier.installation_id != transitions.installation_id
                or physical_verifier.storage_domain_id
                != transitions.storage_domain_id):
            raise CraftMaterializationOrchestratorError(
                "El verificador y la instalación 117 no coinciden.")
        if (getattr(input_source, "inactive_synthetic", None) is not True
                or getattr(physical_verifier, "inactive_synthetic", None)
                is not True):
            raise CraftMaterializationOrchestratorError(
                "El gate 117 sólo admite fuentes y verificadores sintéticos.")
        self._resolver = resolver
        self._database = database
        self._transitions = transitions
        self._materializer = materializer
        self._inputs = input_source
        self._physical = physical_verifier
        self._timeout = float(timeout_seconds)
        self._monotonic = monotonic

    def prepare_claim(self, claim: CreativeAttemptClaim) -> CraftLauncherRequest:
        """Attach or recover one exact generation without starting Craft."""
        item = _claim(claim)
        deadline = self._monotonic() + self._timeout
        self._deadline(deadline)
        context = self._resolver.load_materialization_context(item)
        if not isinstance(context, tuple) or len(context) != 4:
            raise CraftMaterializationOrchestratorError(
                "El contexto 117 no conserva su forma privada.")
        job, adapter, profile, request = context
        if not isinstance(profile, CraftLauncherProfile) or not isinstance(
                request, CraftLauncherRequest):
            raise CraftMaterializationOrchestratorError(
                "El contexto 117 no reconstruyó perfil y request canónicos.")
        self._deadline(deadline)
        bindings = self._inputs.bindings_for(job)
        if (not isinstance(bindings, tuple)
                or any(not isinstance(value, CraftInputBinding)
                       for value in bindings)):
            raise CraftMaterializationOrchestratorError(
                "La fuente privada no reconstruyó bindings tipados.")
        _validate_materialized_inputs(
            job, CraftLauncherMaterialization(
                self._placeholder_root("inputs"),
                self._placeholder_root("outputs"), bindings))
        control = _control_document(job, adapter)
        expected_outputs = _expected_outputs(job, adapter)
        limits = _limits(job).canonical()

        begun = self._begin(item, request)
        intent_id = begun["intentId"]
        logical_plan = {
            "dispatchId": request.body["dispatchId"],
            "profile": profile.canonical(),
            "controlDocument": control,
            "inputs": [value.canonical() for value in bindings],
            "expectedOutputs": list(expected_outputs),
            "limits": limits,
        }
        if begun["state"] in {"planned", "writing"}:
            self._bind_logical(item, intent_id, logical_plan, request)
        elif begun["state"] != "attached":
            raise CraftMaterializationOrchestratorError(
                "El intent 117 no está en una fase recuperable.")

        population = self._claim_population(
            item, intent_id, logical_plan, request)
        status = population["status"]
        if status == "attached":
            self._attached(population, intent_id, request)
            return request
        if status in {"receipt_ready", "finalizing"}:
            self._resume_finalize(item, intent_id, population, request)
            return request
        if status == "busy":
            raise CraftMaterializationRetry(
                "Otra generación 117 conserva el lease de escritura.")
        self._populate_generation(
            item, job, intent_id, begun, population, logical_plan, bindings,
            expected_outputs, profile, control, limits, request, deadline)
        return request

    def cancel_claim(self, claim: CreativeAttemptClaim) -> None:
        """No cancellation capability exists in this inactive preparation port."""
        _claim(claim)
        raise CraftMaterializationOrchestratorError(
            "La cancelación 117 carece de autoridad SQL inyectada.")

    def _invoke(self, operation: str, **arguments: object) -> object:
        try:
            with self._database.connect() as connection:
                return self._transitions.invoke(
                    connection, transition(operation, **arguments))
        except CraftTransitionClientError as error:
            raise CraftMaterializationOrchestratorError(str(error)) from error

    def _begin(self, claim, request) -> dict:
        value = _closed(self._invoke(
            "materialization_begin", user_id=claim.user_id,
            attempt_id=claim.attempt_id), frozenset({
                "created", "intentId", "namespaceId", "dispatchId", "state",
                "planFenceSha256"}), "materialization_begin")
        if (type(value["created"]) is not bool
                or value["dispatchId"] != request.body["dispatchId"]
                or value["state"] not in {"planned", "writing", "attached"}):
            raise CraftMaterializationOrchestratorError(
                "materialization_begin diverge del claim.")
        for key in ("intentId", "namespaceId", "dispatchId"):
            _uuid(value[key], key)
        _sha(value["planFenceSha256"], "planFenceSha256")
        return value

    def _bind_logical(self, claim, intent_id, plan, request) -> dict:
        value = _closed(self._invoke(
            "materialization_bind_plan", user_id=claim.user_id,
            attempt_id=claim.attempt_id, intent_id=intent_id, plan=plan),
            frozenset({"intentId", "intentNamespaceId", "dispatchId", "state",
                       "intentFenceSha256", "logicalPlanSha256", "request"}),
            "materialization_bind_plan")
        if (value["intentId"] != intent_id or value["state"] != "writing"
                or value["dispatchId"] != request.body["dispatchId"]
                or value["request"] != _request_document(request)):
            raise CraftMaterializationOrchestratorError(
                "materialization_bind_plan diverge del request.")
        _uuid(value["intentNamespaceId"], "intentNamespaceId")
        _sha(value["intentFenceSha256"], "intentFenceSha256")
        return value

    def _claim_population(self, claim, intent_id, logical_plan, request) -> dict:
        value = self._invoke(
            "materialization_claim_population", user_id=claim.user_id,
            attempt_id=claim.attempt_id, intent_id=intent_id)
        if not isinstance(value, dict) or not isinstance(value.get("status"), str):
            raise CraftMaterializationOrchestratorError(
                "materialization_claim_population no devolvió estado cerrado.")
        status = value["status"]
        fields = {
            "claimed_unbound": frozenset({
                "status", "populationGenerationId", "populationNamespaceId",
                "populationLeaseToken", "populationLeaseUntil",
                "storageDomainId", "populationFenceSha256", "logicalPlan",
                "logicalPlanSha256"}),
            "busy": frozenset({
                "status", "populationState", "populationGenerationId",
                "storageDomainId", "populationLeaseUntil"}),
            "receipt_ready": frozenset({
                "status", "populationGenerationId", "receiptId",
                "storageDomainId", "populationFenceSha256", "planSha256"}),
            "finalizing": frozenset({
                "status", "populationGenerationId", "receiptId",
                "storageDomainId", "populationFenceSha256", "planSha256",
                "finalizeLeaseUntil"}),
            "attached": frozenset({
                "status", "intentId", "populationGenerationId",
                "storageDomainId", "request", "authoritySha256",
                "profileSha256"}),
        }
        if status not in fields:
            raise CraftMaterializationOrchestratorError(
                "materialization_claim_population devolvió estado desconocido.")
        result = _closed(value, fields[status], "materialization_claim_population")
        if status == "claimed_unbound":
            for key in ("populationGenerationId", "populationNamespaceId",
                        "populationLeaseToken", "storageDomainId"):
                _uuid(result[key], key)
            _timestamp(result["populationLeaseUntil"], "populationLeaseUntil")
            if result["logicalPlan"] != logical_plan:
                raise CraftMaterializationOrchestratorError(
                    "La generación no liga el plan lógico exacto.")
        elif status == "busy":
            _uuid(result["populationGenerationId"], "populationGenerationId")
            _uuid(result["storageDomainId"], "storageDomainId")
            _timestamp(result["populationLeaseUntil"], "populationLeaseUntil")
            if result["populationState"] not in {"claimed_unbound", "writing"}:
                raise CraftMaterializationOrchestratorError(
                    "La población busy no acredita una fase de escritura.")
        elif status in {"receipt_ready", "finalizing"}:
            for key in ("populationGenerationId", "receiptId",
                        "storageDomainId"):
                _uuid(result[key], key)
            # These hashes are the only Python-visible durable binding in a
            # recovered post-I/O state.  SQL rechecks both against the exact
            # physical receipt before it can grant/finalize the attach lease.
            _sha(result["populationFenceSha256"], "populationFenceSha256")
            _sha(result["planSha256"], "planSha256")
            if status == "finalizing":
                _timestamp(result["finalizeLeaseUntil"], "finalizeLeaseUntil")
        else:
            self._attached(result, intent_id, request)
        return result

    def _populate_generation(
        self, claim, job, intent_id, begun, population, logical_plan, bindings,
        expected_outputs, profile, control, limits, request, deadline,
    ) -> None:
        generation = population["populationGenerationId"]
        lease = population["populationLeaseToken"]
        intent = CraftMaterializationIntent(
            installation_id=self._transitions.installation_id,
            storage_domain_id=population["storageDomainId"],
            owner_user_id=claim.user_id, attempt_id=claim.attempt_id,
            intent_id=intent_id, population_generation_id=generation,
            namespace_id=population["populationNamespaceId"],
            dispatch_id=begun["dispatchId"],
            request_sha256=request.request_sha256,
            population_fence_sha256=population["populationFenceSha256"])
        plan = self._materializer.plan(
            intent, inputs=bindings, expected_outputs=expected_outputs,
            profile=profile.canonical(), control_document=control,
            limits=limits)
        bound = self._bind_population(claim, intent_id, lease, plan, request)

        def renew(value=bound) -> bool:
            return value is bound and value == bound and self._renew(
                claim, bound, request)

        receipt_id = None
        physical_started = False
        try:
            self._deadline(deadline)
            self._renew(claim, bound, request)
            self._materializer.prepare(
                bound, revalidate=renew, deadline_monotonic=deadline,
                monotonic=self._monotonic)
            self._deadline(deadline)
            self._renew(claim, bound, request)
            payloads = self._inputs.read_payloads(
                job, bound, deadline_monotonic=deadline, renew=renew)
            self._deadline(deadline)
            self._renew(claim, bound, request)
            populated = self._materializer.populate(
                bound, payloads=payloads, revalidate=renew,
                deadline_monotonic=deadline, monotonic=self._monotonic)
            result = self._materializer.finalize(
                bound, revalidate=renew, deadline_monotonic=deadline,
                monotonic=self._monotonic)
            if (not isinstance(result, CraftMaterializationResult)
                    or result.populate_receipt != populated):
                raise CraftMaterializationOrchestratorError(
                    "El resultado local no liga el receipt de población.")
            self._deadline(deadline)
            self._renew(claim, bound, request)
            physical_started = True
            challenge = self._issue_after_uncertainty(
                claim, intent_id, generation, lease, logical_plan, request)
            if challenge is None:
                return
            self._deadline(deadline)
            self._renew(claim, bound, request)
            try:
                receipt_id = self._physical.verify_materialization_populate(
                    challenge=challenge, plan=plan.sql_document(),
                    populate_receipt=populated)
            except BaseException:
                recovered = self._claim_population(
                    claim, intent_id, logical_plan, request)
                if recovered["status"] == "attached":
                    self._attached(recovered, intent_id, request)
                    return
                if recovered["status"] in {"receipt_ready", "finalizing"}:
                    self._resume_finalize(
                        claim, intent_id, recovered, request)
                    return
                # A still-writing generation proves that no durable receipt
                # can yet be consumed.  Keep it fenced for cleanup/recovery;
                # never repeat physical verification from an uncertain call.
                raise
            _uuid(receipt_id, "receiptId")
            population = {
                "status": "receipt_ready",
                "populationGenerationId": generation,
                "receiptId": receipt_id,
                "storageDomainId": bound.storage_domain_id,
                "populationFenceSha256": bound.population_fence_sha256,
                "planSha256": bound.plan_sha256,
            }
            self._resume_finalize(claim, intent_id, population, request)
        except BaseException:
            if receipt_id is None and not physical_started:
                self._release_population(claim, intent_id, lease)
            raise

    def _issue_after_uncertainty(
        self, claim, intent_id, generation, lease, logical_plan, request,
    ):
        arguments = {
            "user_id": claim.user_id, "attempt_id": claim.attempt_id,
            "intent_id": intent_id, "generation_id": generation,
            "lease_token": lease,
        }
        try:
            return self._physical.issue_materialization_populate(**arguments)
        except BaseException:
            # Challenge issue is create-only under generation+writer token.
            # One exact retry recovers a lost commit response without touching
            # local bytes; a second failure leaves the generation fenced.
            try:
                return self._physical.issue_materialization_populate(**arguments)
            except BaseException:
                recovered = self._claim_population(
                    claim, intent_id, logical_plan, request)
                if recovered["status"] == "attached":
                    self._attached(recovered, intent_id, request)
                    return None
                if recovered["status"] in {"receipt_ready", "finalizing"}:
                    self._resume_finalize(
                        claim, intent_id, recovered, request)
                    return None
                raise

    def _bind_population(self, claim, intent_id, lease, plan, request):
        value = _closed(self._invoke(
            "materialization_bind_population", user_id=claim.user_id,
            attempt_id=claim.attempt_id, intent_id=intent_id,
            lease_token=lease, plan=plan.sql_document()), frozenset({
                "state", "populationGenerationId", "populationNamespaceId",
                "storageDomainId", "populationFenceSha256", "plan",
                "planSha256", "request", "authoritySha256",
                "profileSha256"}), "materialization_bind_population")
        intent = plan.intent
        if (value["state"] != "writing"
                or value["populationGenerationId"]
                != intent.population_generation_id
                or value["populationNamespaceId"] != intent.namespace_id
                or value["storageDomainId"] != intent.storage_domain_id
                or value["populationFenceSha256"]
                != intent.population_fence_sha256
                or value["plan"] != plan.sql_document()
                or value["planSha256"] != plan.plan_sha256
                or value["request"] != _request_document(request)):
            raise CraftMaterializationOrchestratorError(
                "materialization_bind_population diverge del plan exacto.")
        return CraftBoundMaterializationPlan(
            plan=plan, intent_id=intent.intent_id,
            storage_domain_id=value["storageDomainId"],
            population_generation_id=value["populationGenerationId"],
            namespace_id=value["populationNamespaceId"],
            population_lease_token=lease,
            plan_sha256=value["planSha256"],
            population_fence_sha256=value["populationFenceSha256"])

    def _renew(self, claim, bound, request) -> bool:
        value = _closed(self._invoke(
            "materialization_renew_population", user_id=claim.user_id,
            attempt_id=claim.attempt_id, intent_id=bound.intent_id,
            generation_id=bound.population_generation_id,
            lease_token=bound.population_lease_token), frozenset({
                "status", "populationGenerationId", "populationNamespaceId",
                "populationLeaseToken", "populationLeaseUntil",
                "storageDomainId", "populationFenceSha256", "planSha256",
                "request"}), "materialization_renew_population")
        if (value["status"] != "writing"
                or value["populationGenerationId"]
                != bound.population_generation_id
                or value["populationNamespaceId"] != bound.namespace_id
                or value["populationLeaseToken"]
                != bound.population_lease_token
                or value["storageDomainId"] != bound.storage_domain_id
                or value["populationFenceSha256"]
                != bound.population_fence_sha256
                or value["planSha256"] != bound.plan_sha256
                or value["request"] != _request_document(request)):
            raise CraftMaterializationOrchestratorError(
                "La renovación 117 diverge del generation fence.")
        _timestamp(value["populationLeaseUntil"], "populationLeaseUntil")
        return True

    def _resume_finalize(self, claim, intent_id, population, request) -> None:
        generation = population["populationGenerationId"]
        receipt_id = population["receiptId"]
        value = self._invoke(
            "materialization_claim_finalize", user_id=claim.user_id,
            attempt_id=claim.attempt_id, intent_id=intent_id,
            generation_id=generation, receipt_id=receipt_id)
        if not isinstance(value, dict) or value.get("status") not in {
                "busy", "finalizing"}:
            raise CraftMaterializationOrchestratorError(
                "materialization_claim_finalize no devolvió estado cerrado.")
        status = value["status"]
        fields = (frozenset({"status", "populationGenerationId", "receiptId",
                             "storageDomainId", "finalizeLeaseUntil"})
                  if status == "busy" else
                  frozenset({"status", "populationGenerationId", "receiptId",
                             "finalizeToken", "finalizeLeaseUntil",
                             "storageDomainId"}))
        value = _closed(value, fields, "materialization_claim_finalize")
        if (value["populationGenerationId"] != generation
                or value["receiptId"] != receipt_id
                or value["storageDomainId"] != population["storageDomainId"]):
            raise CraftMaterializationOrchestratorError(
                "El lease finalize no coincide con la generación.")
        _timestamp(value["finalizeLeaseUntil"], "finalizeLeaseUntil")
        if status == "busy":
            raise CraftMaterializationRetry(
                "Otra ejecución conserva el lease finalize 117.")
        token = _uuid(value["finalizeToken"], "finalizeToken")
        try:
            finalized = self._invoke(
                "materialization_finalize", user_id=claim.user_id,
                attempt_id=claim.attempt_id, intent_id=intent_id,
                generation_id=generation, receipt_id=receipt_id,
                finalize_token=token)
            self._finalized(finalized, intent_id, generation, request)
        except BaseException:
            self._release_finalize(
                claim, intent_id, generation, receipt_id, token)
            raise

    def _finalized(self, value, intent_id, generation, request) -> dict:
        result = _closed(value, frozenset({
            "created", "intentId", "populationGenerationId", "state",
            "request", "authoritySha256", "profileSha256"}),
            "materialization_finalize")
        if (type(result["created"]) is not bool
                or result["intentId"] != intent_id
                or result["populationGenerationId"] != generation
                or result["state"] != "attached"
                or result["request"] != _request_document(request)):
            raise CraftMaterializationOrchestratorError(
                "materialization_finalize no acreditó el request exacto.")
        return result

    def _attached(self, value, intent_id, request) -> None:
        if (value["intentId"] != intent_id
                or value["request"] != _request_document(request)):
            raise CraftMaterializationOrchestratorError(
                "La proyección attached no coincide con el request.")
        _uuid(value["populationGenerationId"], "populationGenerationId")
        _uuid(value["storageDomainId"], "storageDomainId")

    def _release_population(self, claim, intent_id, lease) -> None:
        try:
            self._invoke(
                "materialization_release_population", user_id=claim.user_id,
                attempt_id=claim.attempt_id, intent_id=intent_id,
                lease_token=lease)
        except BaseException:
            pass

    def _release_finalize(
        self, claim, intent_id, generation, receipt_id, token,
    ) -> None:
        try:
            self._invoke(
                "materialization_release_finalize", user_id=claim.user_id,
                attempt_id=claim.attempt_id, intent_id=intent_id,
                generation_id=generation, receipt_id=receipt_id,
                finalize_token=token)
        except BaseException:
            pass

    def _deadline(self, deadline: float) -> None:
        if self._monotonic() >= deadline:
            raise CraftMaterializationOrchestratorError(
                "El deadline privado de materialización venció.")

    @staticmethod
    def _placeholder_root(name: str):
        # Validation only; no filesystem call observes this path.
        from pathlib import Path
        return Path("/") / "inactive-craft-117" / name

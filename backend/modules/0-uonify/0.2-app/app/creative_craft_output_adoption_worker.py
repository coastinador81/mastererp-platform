"""Inactive PostgreSQL worker for exact Craft escrow adoption and cleanup.

The worker is deliberately not wired into application startup.  Its only port
copies artifacts into durable private storage.  Launcher is the sole authority
that may delete its source bytes; PostgreSQL proves leases, fences, adoption
evidence and reconciliation after that Launcher cleanup.
"""

from dataclasses import dataclass
from datetime import timedelta
from typing import Protocol
from uuid import UUID, uuid4

from .creative_composite_quote import canonical_sha256
from .creative_craft_output_escrow import (
    CraftEscrowArtifact, CraftEscrowManifest, CraftOutputEscrow,
    CraftOutputEscrowError, begin_craft_output_adoption,
    confirm_craft_output_adoption, request_craft_output_cleanup,
    validate_craft_output_escrow_manifest,
)
from .creative_storage_contracts import StorageReceipt
from .creative_craft_transition_client import (
    CraftTransitionClient, CraftTransitionClientError, transition,
)


_ACTIVE = frozenset({"adopting", "reconciling_cleanup"})
_STORED = frozenset({
    "quarantined", "review_pending", "blocked", "approved_for_use",
    "revision_requested", "released",
})


@dataclass(frozen=True)
class CraftOutputAdoptionLease:
    manifest: CraftEscrowManifest
    candidate_id: str
    phase: str
    lease_token: str
    version: int


class CraftOutputAdoptionPort(Protocol):
    def adopt(self, lease: CraftOutputAdoptionLease) -> dict:
        """Durably adopt all artifacts, returning the closed handshake."""


class CraftAdoptionPhysicalReceipts(Protocol):
    def verify_adopt_copy(self, *, user_id: str, escrow_id: str,
                          version: int, lease_token: str) -> str: ...


def _uuid(value: object, label: str) -> str:
    try:
        parsed = str(UUID(str(value)))
    except (TypeError, ValueError, AttributeError):
        raise CraftOutputEscrowError(f"{label} no es UUID.") from None
    if str(value) != parsed:
        raise CraftOutputEscrowError(f"{label} no es UUID canónico.")
    return parsed


def _receipt(value: object) -> StorageReceipt:
    fields = {"bucket", "name", "generation", "mimeType", "byteSize", "sha256"}
    if not isinstance(value, dict) or set(value) != fields:
        raise CraftOutputEscrowError("StorageReceipt durable no es cerrado.")
    return StorageReceipt(
        value["bucket"], value["name"], value["generation"],
        value["mimeType"], value["byteSize"], value["sha256"])


def _closed_response(value: object, expected: dict, label: str) -> None:
    if not isinstance(value, dict) or value != expected:
        raise CraftOutputEscrowError(f"{label} no coincide con el escrow exacto.")


class PostgresCraftOutputAdoptionWorker:
    """Lease/CAS worker; constructing it has no external side effect."""

    def __init__(self, database, port: CraftOutputAdoptionPort,
                 *, transitions: CraftTransitionClient | None = None,
                 physical_receipts: CraftAdoptionPhysicalReceipts | None = None,
                 lease_seconds: int = 90, retry_base_seconds: int = 5):
        if not isinstance(lease_seconds, int) or not 5 <= lease_seconds <= 900:
            raise ValueError("El lease de escrow no es válido.")
        if (not isinstance(retry_base_seconds, int)
                or not 1 <= retry_base_seconds <= 60):
            raise ValueError("El backoff de escrow no es válido.")
        self._database = database
        self._port = port
        self._transitions = transitions
        self._physical_receipts = physical_receipts
        self._lease_seconds = lease_seconds
        self._retry_base_seconds = retry_base_seconds

    def _transition(self, connection, operation, **arguments):
        if not isinstance(self._transitions, CraftTransitionClient):
            raise CraftOutputEscrowError(
                "La autoridad SQL Craft 114 no está inyectada.")
        try:
            return self._transitions.invoke(
                connection, transition(operation, **arguments))
        except CraftTransitionClientError as error:
            raise CraftOutputEscrowError(str(error)) from error

    def _physical(self) -> CraftAdoptionPhysicalReceipts:
        if self._physical_receipts is None:
            raise CraftOutputEscrowError(
                "El verificador storage Craft 114 no está inyectado.")
        return self._physical_receipts

    def _retry_delay(self, attempt_count: int) -> timedelta:
        exponent = min(max(attempt_count - 1, 0), 6)
        seconds = min(300, self._retry_base_seconds * (2 ** exponent))
        return timedelta(seconds=seconds)

    @staticmethod
    def _row_manifest(row: dict) -> CraftEscrowManifest:
        manifest = validate_craft_output_escrow_manifest(row["escrow_manifest"])
        if (manifest.manifest_sha256 != row["escrow_manifest_sha256"]
                or manifest.artifact_manifest_sha256
                != row["artifact_manifest_sha256"]
                or manifest.candidate_result_sha256
                != row["candidate_result_sha256"]
                or manifest.engine_name != row["engine"]):
            raise CraftOutputEscrowError("La fila de escrow no liga su manifest.")
        return manifest

    @staticmethod
    def _assert_candidate_receipt_binding(
            receipt: object, manifest: CraftEscrowManifest) -> None:
        if not isinstance(receipt, dict):
            raise CraftOutputEscrowError(
                "El receipt candidato no liga el escrow exacto.")
        engine = receipt.get("engine")
        expected_engine = {
            "name": manifest.engine_name,
            "version": manifest.engine_version,
            "operation": manifest.operation,
        }
        if (not isinstance(engine, dict)
                or set(engine) != {
                    "name", "version", "operation", "engineJobId"}
                or {key: engine.get(key) for key in expected_engine}
                != expected_engine):
            raise CraftOutputEscrowError(
                "El engine candidato no liga el escrow exacto.")

        outputs = receipt.get("outputs")
        output_artifacts = tuple(
            item for item in manifest.artifacts if item.kind == "output")
        if (not isinstance(outputs, list)
                or len(outputs) != len(output_artifacts)):
            raise CraftOutputEscrowError(
                "Los outputs candidatos no ligan el escrow exacto.")
        for ordinal, (output, artifact) in enumerate(
                zip(outputs, output_artifacts)):
            expected = (
                artifact.relative_path, artifact.role, artifact.mime_type,
                artifact.byte_size, artifact.sha256)
            if (not isinstance(output, dict)
                    or manifest.artifacts[ordinal] != artifact
                    or artifact.ordinal != ordinal
                    or output.get("ordinal") != ordinal
                    or (output.get("relativePath"), output.get("role"),
                        output.get("mimeType"), output.get("byteSize"),
                        output.get("sha256")) != expected):
                raise CraftOutputEscrowError(
                    "Los outputs candidatos no ligan el escrow exacto.")

        native = receipt.get("nativeProject")
        native_artifacts = tuple(
            item for item in manifest.artifacts
            if item.kind == "native_project")
        if manifest.engine_name == "effectcraft":
            if native_artifacts:
                raise CraftOutputEscrowError(
                    "EffectCraft no admite proyecto nativo en el escrow.")
            return
        native_fields = {"relativePath", "mimeType", "byteSize", "sha256"}
        if (not isinstance(native, dict) or set(native) != native_fields
                or len(native_artifacts) != 1):
            raise CraftOutputEscrowError(
                "El proyecto nativo candidato no liga el escrow exacto.")
        artifact = native_artifacts[0]
        if (manifest.artifacts[-1] != artifact
                or artifact.ordinal != len(output_artifacts)
                or tuple(native[key] for key in (
                "relativePath", "mimeType", "byteSize", "sha256")) != (
                artifact.relative_path, artifact.mime_type,
                artifact.byte_size, artifact.sha256)):
            raise CraftOutputEscrowError(
                "El proyecto nativo candidato no liga el escrow exacto.")

    def enqueue(self, owner_user_id: str, source_attempt_id: str,
                candidate_id: str) -> CraftEscrowManifest:
        """Derive and return the durable escrow through the 114 authority."""
        owner = _uuid(owner_user_id, "ownerUserId")
        attempt_id = _uuid(source_attempt_id, "sourceAttemptId")
        candidate = _uuid(candidate_id, "candidateId")
        with self._database.connect() as connection:
            result = self._transition(
                connection, "escrow_enqueue", user_id=owner,
                attempt_id=attempt_id, candidate_id=candidate)
            try:
                manifest = validate_craft_output_escrow_manifest(result)
            except CraftOutputEscrowError as error:
                raise CraftOutputEscrowError(
                    "La transición 114 no derivó un escrow cerrado.") from error
            fence = manifest.fence
            if (fence.owner_user_id != owner
                    or fence.attempt_id != attempt_id):
                raise CraftOutputEscrowError(
                    "La transición 114 derivó otro owner o intento.")
            authority = connection.execute(
                """SELECT t.status AS attempt_status,t.provider_returned_at,
                          r.craft_candidate_result_sha256,r.receipt,
                          l.reservation_receipt_sha256,l.compensation_status
                     FROM creative_execution_attempts t
                     JOIN creative_candidate_receipts r
                       ON r.user_id=t.user_id AND r.attempt_id=t.id
                     JOIN creative_craft_launcher_reservations l
                       ON l.user_id=t.user_id AND l.attempt_id=t.id
                    WHERE t.user_id=%s AND t.id=%s AND r.id=%s
                      AND t.job_id=%s AND t.step_id=%s AND t.attempt_no=%s
                      AND t.claim_lease_token=%s AND t.fence_epoch=%s
                      AND t.admission_sha256=%s AND t.claim_set_sha256=%s
                      AND l.dispatch_id=%s AND l.request_sha256=%s
                      AND l.authority_sha256=%s
                    FOR SHARE OF t,r,l""",
                (fence.owner_user_id, fence.attempt_id, candidate,
                 fence.job_id, fence.step_id, fence.attempt_no,
                 fence.claim_lease_token, fence.fence_epoch,
                 fence.admission_sha256, fence.claim_set_sha256,
                 manifest.dispatch_id, manifest.request_sha256,
                 manifest.authority_sha256),
            ).fetchone()
            if (not authority or authority["attempt_status"] != "succeeded"
                    or authority["provider_returned_at"] is None
                    or authority["craft_candidate_result_sha256"]
                    != manifest.candidate_result_sha256
                    or authority["reservation_receipt_sha256"] is None
                    or authority["compensation_status"] != "confirmed"):
                raise CraftOutputEscrowError(
                    "El escrow no procede de un intento Craft confirmado.")
            self._assert_candidate_receipt_binding(
                authority["receipt"], manifest)
            row = connection.execute(
                """SELECT * FROM creative_craft_output_adoption_outbox
                    WHERE user_id=%s AND source_attempt_id=%s""",
                (fence.owner_user_id, fence.attempt_id),
            ).fetchone()
            if (not row or str(row["escrow_id"]) != manifest.escrow_id
                    or str(row["candidate_id"]) != candidate
                    or row["escrow_manifest"] != manifest.canonical()):
                raise CraftOutputEscrowError("El intento ya liga otro escrow.")
            return manifest

    def claim_next(self) -> CraftOutputAdoptionLease | None:
        """Claim one exact shortlisted escrow through the installed API."""
        with self._database.connect() as connection:
            owners = connection.execute(
                """SELECT user_id,min(created_at) AS oldest
                     FROM creative_craft_output_adoption_outbox
                    WHERE available_at<=clock_timestamp()
                      AND (state IN ('pending_adoption','reconciliation_pending')
                        OR (state IN ('adopting','reconciling_cleanup')
                            AND lease_until<=clock_timestamp()))
                    GROUP BY user_id ORDER BY oldest,user_id""").fetchall()
        for owner in owners:
            user_id = str(owner["user_id"])
            # One transaction never accumulates advisory locks for two owners.
            with self._database.connect() as connection:
                shortlist = self._transition(
                    connection, "escrow_shortlist", user_id=user_id)
                if not isinstance(shortlist, list):
                    raise CraftOutputEscrowError(
                        "La shortlist 114 no es una lista cerrada.")
                for hint in shortlist:
                    if (not isinstance(hint, dict)
                            or set(hint) != {"userId", "escrowId",
                                             "version", "state"}
                            or str(hint["userId"]) != user_id):
                        raise CraftOutputEscrowError(
                            "La shortlist 114 contiene otro scope.")
                    claimed = self._transition(
                        connection, "escrow_claim", user_id=user_id,
                        escrow_id=str(hint["escrowId"]))
                    if claimed is None:
                        continue
                    keys = {"userId", "escrowId", "sourceAttemptId",
                            "candidateId", "state", "version", "leaseToken",
                            "escrowManifest"}
                    if (not isinstance(claimed, dict) or set(claimed) != keys
                            or str(claimed["userId"]) != user_id
                            or str(claimed["escrowId"])
                            != str(hint["escrowId"])):
                        raise CraftOutputEscrowError(
                            "El claim 114 no coincide con su shortlist.")
                    manifest = validate_craft_output_escrow_manifest(
                        claimed["escrowManifest"])
                    token = _uuid(claimed["leaseToken"], "leaseToken")
                    candidate = _uuid(
                        claimed["candidateId"], "candidateId")
                    version = claimed["version"]
                    if (type(version) is not int or version < 1
                            or claimed["state"] not in _ACTIVE):
                        raise CraftOutputEscrowError(
                            "El claim 114 no contiene un lease cerrado.")
                    return CraftOutputAdoptionLease(
                        manifest, candidate, claimed["state"], token, version)
        return None

    @staticmethod
    def _evidence(connection, lease: CraftOutputAdoptionLease) -> tuple:
        manifest, fence = lease.manifest, lease.manifest.fence
        candidate = connection.execute(
            """SELECT r.receipt,r.craft_candidate_result_sha256,s.state,
                      s.quarantine_set_sha256,t.status AS attempt_status
                 FROM creative_candidate_receipts r
                 JOIN creative_candidate_states s
                   ON s.user_id=r.user_id AND s.candidate_id=r.id
                 JOIN creative_execution_attempts t
                   ON t.user_id=r.user_id AND t.id=r.attempt_id
                WHERE r.user_id=%s AND r.id=%s AND r.attempt_id=%s
                FOR SHARE OF r,s,t""",
            (fence.owner_user_id, lease.candidate_id, fence.attempt_id),
        ).fetchone()
        if (not candidate or candidate["attempt_status"] != "succeeded"
                or candidate["craft_candidate_result_sha256"]
                != manifest.candidate_result_sha256
                or candidate["state"] not in _STORED
                or not candidate["quarantine_set_sha256"]):
            raise CraftOutputEscrowError(
                "El candidato aún no tiene adopción privada durable.")
        receipt = candidate["receipt"]
        PostgresCraftOutputAdoptionWorker._assert_candidate_receipt_binding(
            receipt, manifest)
        quarantine = connection.execute(
            """SELECT item_count,adoption_attempt_id,adoption_fence_epoch,
                      adoption_result_sha256
                 FROM creative_candidate_quarantines
                WHERE user_id=%s AND candidate_id=%s FOR SHARE""",
            (fence.owner_user_id, lease.candidate_id),
        ).fetchone()
        if not quarantine:
            raise CraftOutputEscrowError(
                "El candidato aún no tiene adopción privada durable.")
        outputs = receipt.get("outputs") if isinstance(receipt, dict) else None
        output_artifacts = [item for item in manifest.artifacts
                            if item.kind == "output"]
        if not isinstance(outputs, list) or len(outputs) != len(output_artifacts):
            raise CraftOutputEscrowError("La cuarentena no cubre los outputs.")
        rows = connection.execute(
            """SELECT a.ordinal,a.storage_receipt
                 FROM creative_candidate_quarantine_assets a
                WHERE a.user_id=%s AND a.candidate_id=%s
                ORDER BY a.ordinal""",
            (fence.owner_user_id, lease.candidate_id),
        ).fetchall()
        if (len(rows) != len(output_artifacts)
                or quarantine["item_count"] != len(rows)):
            raise CraftOutputEscrowError("Faltan StorageReceipts de cuarentena.")
        storage: dict[int, StorageReceipt] = {}
        for ordinal, (artifact, output, row) in enumerate(
                zip(output_artifacts, outputs, rows)):
            if (row["ordinal"] != ordinal
                    or (output.get("relativePath"), output.get("role"),
                        output.get("mimeType"), output.get("byteSize"),
                        output.get("sha256")) !=
                       (artifact.relative_path, artifact.role,
                        artifact.mime_type, artifact.byte_size,
                        artifact.sha256)):
                raise CraftOutputEscrowError("Un output adoptado no es exacto.")
            storage[artifact.ordinal] = _receipt(row["storage_receipt"])
        native = [item for item in manifest.artifacts
                  if item.kind == "native_project"]
        native_rows = connection.execute(
            """SELECT v.engine,v.operation,v.mime_type,v.byte_size,v.sha256,
                      v.storage_bucket,v.storage_name,v.storage_generation
                 FROM creative_candidate_native_projects l
                 JOIN creative_native_project_revisions v
                   ON v.user_id=l.user_id AND v.project_id=l.project_id
                  AND v.revision=l.revision
                WHERE l.user_id=%s AND l.candidate_id=%s""",
            (fence.owner_user_id, lease.candidate_id),
        ).fetchall()
        if len(native_rows) != len(native):
            raise CraftOutputEscrowError("El proyecto nativo durable no es exacto.")
        if native:
            artifact, row = native[0], native_rows[0]
            if (row["engine"], row["operation"], row["mime_type"],
                    row["byte_size"], row["sha256"]) != (
                    manifest.engine_name, manifest.operation,
                    artifact.mime_type, artifact.byte_size, artifact.sha256):
                raise CraftOutputEscrowError("El proyecto nativo cambió.")
            storage[artifact.ordinal] = StorageReceipt(
                row["storage_bucket"], row["storage_name"],
                row["storage_generation"], row["mime_type"],
                row["byte_size"], row["sha256"])
        if set(storage) != set(range(len(manifest.artifacts))):
            raise CraftOutputEscrowError("La adopción no cubre cada ordinal.")
        return (tuple(storage[index] for index in range(len(storage))),
                candidate["quarantine_set_sha256"], candidate["state"],
                quarantine["adoption_attempt_id"],
                quarantine["adoption_fence_epoch"],
                quarantine["adoption_result_sha256"])

    def confirm_adoption(self, lease: CraftOutputAdoptionLease,
                         response: object) -> str:
        expected = {"schemaVersion": 1,
                    "escrowId": lease.manifest.escrow_id,
                    "manifestSha256": lease.manifest.manifest_sha256,
                    "candidateId": lease.candidate_id, "status": "durable"}
        _closed_response(response, expected, "La respuesta de adopción")
        with self._database.connect() as connection:
            row = connection.execute(
                """SELECT * FROM creative_craft_output_adoption_outbox
                    WHERE user_id=%s AND escrow_id=%s
                      AND lease_until>clock_timestamp()""",
                (lease.manifest.fence.owner_user_id,
                 lease.manifest.escrow_id),
            ).fetchone()
            self._assert_lease(row, lease, "adopting")
            (receipts, quarantine_sha, _state, adoption_attempt_id,
             adoption_fence_epoch, adoption_result_sha256) = self._evidence(
                 connection, lease)
            value = begin_craft_output_adoption(CraftOutputEscrow(lease.manifest))
            adopted = confirm_craft_output_adoption(value, receipts)
        receipt_id = self._physical().verify_adopt_copy(
            user_id=lease.manifest.fence.owner_user_id,
            escrow_id=lease.manifest.escrow_id, version=lease.version,
            lease_token=lease.lease_token)
        with self._database.connect() as connection:
            completed = self._transition(
                connection, "complete_adoption",
                user_id=lease.manifest.fence.owner_user_id,
                escrow_id=lease.manifest.escrow_id, version=lease.version,
                lease_token=lease.lease_token, receipt_id=receipt_id)
        if completed != adopted.adoption_manifest_sha256:
            raise CraftOutputEscrowError(
                "La finalización 114 de adopción no coincide.")
        return adopted.adoption_manifest_sha256

    def schedule_cleanup_reconciliation(self, user_id: str,
                                        escrow_id: str) -> bool:
        owner, escrow = _uuid(user_id, "userId"), _uuid(escrow_id, "escrowId")
        with self._database.connect() as connection:
            row = connection.execute(
                """SELECT state,version
                     FROM creative_craft_output_adoption_outbox
                    WHERE user_id=%s AND escrow_id=%s""",
                (owner, escrow)).fetchone()
            if not row:
                raise CraftOutputEscrowError("Escrow desconocido.")
            if row["state"] == "reconciliation_pending":
                return False
            if row["state"] != "adopted":
                raise CraftOutputEscrowError("El escrow aún no está adoptado.")
            value = self._transition(
                connection, "escrow_schedule_cleanup", user_id=owner,
                escrow_id=escrow, version=row["version"])
        if type(value) is not bool:
            raise CraftOutputEscrowError(
                "schedule_cleanup 114 no devolvió un booleano.")
        if not value:
            raise CraftOutputEscrowError(
                "El escrow cambió antes de programar cleanup.")
        return True

    def authorize_next_cleanup(self) -> str | None:
        """Recover adoption commits using schedule/defer API 114 only."""
        with self._database.connect() as connection:
            rows = connection.execute(
                """SELECT user_id,escrow_id,version
                     FROM creative_craft_output_adoption_outbox
                    WHERE state='adopted'
                      AND available_at<=clock_timestamp()
                    ORDER BY adopted_at,user_id,escrow_id LIMIT 32""").fetchall()
        for row in rows:
            owner, escrow = str(row["user_id"]), str(row["escrow_id"])
            with self._database.connect() as connection:
                scheduled = self._transition(
                    connection, "escrow_schedule_cleanup", user_id=owner,
                    escrow_id=escrow, version=row["version"])
                if scheduled is True:
                    return escrow
                deferred = self._transition(
                    connection, "escrow_defer_cleanup", user_id=owner,
                    escrow_id=escrow, version=row["version"])
                if deferred is not True:
                    raise CraftOutputEscrowError(
                        "El escrow cambió antes de diferir cleanup.")
        return None

    def _assert_durable_identity(
            self, row: dict | None, lease: CraftOutputAdoptionLease) -> None:
        if not row:
            raise CraftOutputEscrowError("El lease de escrow ya no es vigente.")
        durable = self._row_manifest(row)
        if (durable.canonical() != lease.manifest.canonical()
                or durable.manifest_sha256 != lease.manifest.manifest_sha256
                or str(row["candidate_id"]) != lease.candidate_id):
            raise CraftOutputEscrowError(
                "El lease no coincide con el escrow durable exacto.")

    def _assert_lease(self, row: dict | None,
                      lease: CraftOutputAdoptionLease, phase: str) -> None:
        if (not row or row["state"] != phase or row["version"] != lease.version
                or str(row["lease_token"]) != lease.lease_token
                or row["lease_until"] is None):
            raise CraftOutputEscrowError("El lease de escrow ya no es vigente.")
        self._assert_durable_identity(row, lease)

    @staticmethod
    def _launcher_ack_locked(connection, row: dict) -> dict:
        ack = connection.execute(
            """SELECT *
                 FROM creative_craft_launcher_ack_outbox
                WHERE user_id=%s AND source_attempt_id=%s""",
            (row["user_id"], row["source_attempt_id"]),
        ).fetchone()
        exact = (
            ("job_id", row["job_id"]),
            ("source_step_id", row["source_step_id"]),
            ("attempt_no", row["attempt_no"]),
            ("claim_lease_token", row["claim_lease_token"]),
            ("fence_epoch", row["fence_epoch"]),
            ("admission_sha256", row["admission_sha256"]),
            ("claim_set_sha256", row["claim_set_sha256"]),
            ("kind", row["kind"]),
            ("provider_call", row["provider_call"]),
            ("terminal_status", row["terminal_status"]),
            ("dispatch_id", row["dispatch_id"]),
            ("request_sha256", row["request_sha256"]),
            ("authority_sha256", row["authority_sha256"]),
            ("candidate_id", row["candidate_id"]),
            ("quarantine_set_sha256", row["quarantine_set_sha256"]),
            ("adoption_attempt_id", row["adoption_attempt_id"]),
            ("adoption_fence_epoch", row["adoption_fence_epoch"]),
            ("adoption_result_sha256", row["adoption_result_sha256"]),
        )
        if (not ack or ack["status"] != "done"
                or ack["completed_at"] is None
                or str(ack["source_attempt_id"])
                != str(row["source_attempt_id"])
                or any(ack[key] != expected for key, expected in exact)):
            raise CraftOutputEscrowError(
                "La reconciliación no tiene un ACK Launcher durable exacto.")
        return ack

    def authorize_cleanup_reconciliation(
            self, lease: CraftOutputAdoptionLease) -> bool:
        """Revalidate the live lease and exact ACK before reconciliation."""
        with self._database.connect() as connection:
            row = connection.execute(
                """SELECT * FROM creative_craft_output_adoption_outbox
                    WHERE user_id=%s AND escrow_id=%s
                      AND lease_until>clock_timestamp()""",
                (lease.manifest.fence.owner_user_id,
                 lease.manifest.escrow_id)).fetchone()
            self._assert_lease(row, lease, "reconciling_cleanup")
            self._launcher_ack_locked(connection, row)
        return True

    def complete_cleanup_reconciliation(
            self, lease: CraftOutputAdoptionLease) -> str:
        """Forget escrow after Launcher proves its own cleanup via exact ACK."""
        with self._database.connect() as connection:
            row = connection.execute(
                """SELECT * FROM creative_craft_output_adoption_outbox
                    WHERE user_id=%s AND escrow_id=%s
                      AND lease_until>clock_timestamp()""",
                (lease.manifest.fence.owner_user_id,
                 lease.manifest.escrow_id)).fetchone()
            self._assert_lease(row, lease, "reconciling_cleanup")
            ack = self._launcher_ack_locked(connection, row)
            expected = {"schemaVersion": 1,
                        "escrowId": lease.manifest.escrow_id,
                        "manifestSha256": lease.manifest.manifest_sha256,
                        "status": "launcher_forgotten",
                        "launcherAck": {
                            "sourceAttemptId": str(ack["source_attempt_id"]),
                            "dispatchId": str(ack["dispatch_id"]),
                            "requestSha256": ack["request_sha256"],
                            "authoritySha256": ack["authority_sha256"],
                            "terminalReceiptSha256":
                                ack["terminal_receipt_sha256"],
                        }}
            receipt_sha = canonical_sha256(expected)
            completed = self._transition(
                connection, "complete_cleanup",
                user_id=lease.manifest.fence.owner_user_id,
                escrow_id=lease.manifest.escrow_id, version=lease.version,
                lease_token=lease.lease_token)
            if completed != receipt_sha:
                raise CraftOutputEscrowError(
                    "El lease de reconciliación cambió.")
        return receipt_sha

    def release(self, lease: CraftOutputAdoptionLease, error: Exception) -> bool:
        if lease.phase not in _ACTIVE:
            raise CraftOutputEscrowError("La fase no posee lease liberable.")
        with self._database.connect() as connection:
            row = connection.execute(
                """SELECT * FROM creative_craft_output_adoption_outbox
                    WHERE user_id=%s AND escrow_id=%s""",
                (lease.manifest.fence.owner_user_id,
                 lease.manifest.escrow_id),
            ).fetchone()
            # A stale token/version may legitimately return False from the
            # transition CAS, but a caller must never release another
            # candidate or manifest through those otherwise valid values.
            self._assert_durable_identity(row, lease)
            released = self._transition(
                connection, "escrow_release",
                user_id=lease.manifest.fence.owner_user_id,
                escrow_id=lease.manifest.escrow_id, version=lease.version,
                lease_token=lease.lease_token)
            return released is True

    def run_once(self) -> str | None:
        recovered = self.authorize_next_cleanup()
        lease = self.claim_next()
        if lease is None:
            return "cleanup_authorized" if recovered else None
        try:
            if lease.phase == "adopting":
                response = self._port.adopt(lease)
                self.confirm_adoption(lease, response)
                self.schedule_cleanup_reconciliation(
                    lease.manifest.fence.owner_user_id,
                    lease.manifest.escrow_id)
                return "adopted"
            self.authorize_cleanup_reconciliation(lease)
            self.complete_cleanup_reconciliation(lease)
            return "deleted"
        except Exception as error:
            try:
                self.release(lease, error)
            except CraftOutputEscrowError as release_error:
                # The preceding transaction may have committed even if its
                # acknowledgement was lost.  Preserve that original failure;
                # recovery will continue from the durable adopted/deleted row.
                if str(release_error) != (
                        "El lease de escrow ya no es vigente."):
                    raise
            raise

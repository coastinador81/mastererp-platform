"""Fail-closed completion gates for candidate lifecycle side receipts."""

from .craft_candidate import candidate_result_sha256


def lock_active_owner(c, user_id: str) -> dict | None:
    row = c.execute('''SELECT * FROM users WHERE id=%s
        FOR NO KEY UPDATE''', (user_id,)).fetchone()
    return row if row and row['deletion_requested_at'] is None else None


def candidate_side_receipt_ready(c, attempt: dict) -> bool:
    """Return whether a candidate-producing attempt has its exact side receipt."""
    kind = attempt.get('kind')
    if kind == 'craft':
        lifecycle_v2 = c.execute('''SELECT 1 FROM creative_execution_steps
            WHERE user_id=%s AND job_id=%s AND kind='candidate_adopt' LIMIT 1''',
            (attempt['user_id'], attempt['job_id'])).fetchone()
        if not lifecycle_v2:
            return True
        result = attempt.get('result_receipt')
        if not isinstance(result, dict):
            return False
        craft_sha256 = candidate_result_sha256(result)
        row = c.execute('''SELECT 1 FROM creative_candidate_receipts
            WHERE user_id=%s AND job_id=%s AND step_id=%s AND attempt_id=%s
              AND attempt_no=%s AND lease_token=%s AND fence_epoch=%s
              AND admission_id=%s AND admission_sha256=%s
              AND claim_set_sha256=%s AND craft_candidate_result_sha256=%s''',
            (attempt['user_id'], attempt['job_id'], attempt['step_id'],
             attempt['id'], attempt['attempt_no'], attempt['claim_lease_token'],
             attempt['fence_epoch'], attempt['admission_id'],
             attempt['admission_sha256'], attempt['claim_set_sha256'],
             craft_sha256)).fetchone()
        return row is not None
    if kind == 'candidate_adopt':
        row = c.execute('''SELECT 1 FROM creative_candidate_quarantines
            WHERE user_id=%s AND job_id=%s AND adoption_step_id=%s
              AND adoption_attempt_id=%s AND adoption_attempt_no=%s
              AND adoption_lease_token=%s AND adoption_fence_epoch=%s
              AND admission_id=%s AND admission_sha256=%s
              AND claim_set_sha256=%s AND adoption_result_sha256=%s''',
            (attempt['user_id'], attempt['job_id'], attempt['step_id'],
             attempt['id'], attempt['attempt_no'], attempt['claim_lease_token'],
             attempt['fence_epoch'], attempt['admission_id'],
             attempt['admission_sha256'], attempt['claim_set_sha256'],
             attempt['result_sha256'])).fetchone()
        return row is not None
    return True

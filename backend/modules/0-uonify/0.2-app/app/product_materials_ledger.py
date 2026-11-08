"""Durable provider-call accounting; unknown consumption is never represented as free."""
from uuid import uuid4
from psycopg.types.json import Jsonb


class MaterialsLedger:
    def budget(self, c, row):
        totals = c.execute('''SELECT count(*) AS calls,coalesce(sum(total_tokens),0) AS tokens,
            coalesce(sum(reserved_tokens) FILTER(WHERE state IN ('running','unknown')
                OR coalesce((usage->>'unconfirmedCalls')::integer,0)>0),0) AS reserved,
            count(*) FILTER(WHERE state='unknown' OR coalesce((usage->>'unconfirmedCalls')::integer,0)>0) AS unknown FROM product_material_calls WHERE job_id=%s''',
                           (row['id'],)).fetchone()
        base = row['result'].get('legacyUsage', {})
        return {'maxCalls': row['max_calls'], 'usedCalls': int(totals['calls']) + int(base.get('calls', 0)),
                'maxTokens': row['max_tokens'], 'usedTokens': int(totals['tokens']) + int(base.get('totalTokenCount', 0)),
                'reservedTokens': int(totals['reserved']), 'unknownCalls': int(totals['unknown']) + int(base.get('unconfirmedCalls', 0))}

    def reserve_call(self, job_id, user_id, lease_token, fragment_ids, max_output_tokens=8192, estimated_input_tokens=0):
        from .product_materials_queue import BudgetPause
        with self.database.connect() as c:
            row = self.assert_lease(c, job_id, user_id, lease_token)
            if row['pause_requested']:
                raise BudgetPause('user_requested')
            unknown = c.execute("""SELECT id FROM product_material_calls WHERE job_id=%s AND state='unknown'
                AND acknowledged_at IS NULL LIMIT 1""", (job_id,)).fetchone()
            if unknown:
                raise BudgetPause('consumption_unknown')
            budget = self.budget(c, row)
            reservation = max(0, int(max_output_tokens)) + max(0, int(estimated_input_tokens))
            if budget['usedCalls'] >= budget['maxCalls'] or budget['usedTokens'] + budget['reservedTokens'] + reservation > budget['maxTokens']:
                raise BudgetPause()
            call_id = uuid4()
            c.execute('''INSERT INTO product_material_calls(id,job_id,lease_token,fragment_ids,state,reserved_tokens)
                VALUES(%s,%s,%s,%s,'running',%s)''', (call_id, job_id, lease_token, Jsonb(list(fragment_ids)), reservation))
            c.execute("""UPDATE product_material_fragments SET state='running',updated_at=now()
                WHERE job_id=%s AND id=ANY(%s) AND state IN ('pending','partial','error')""", (job_id, list(fragment_ids)))
        return call_id

    def finish_call(self, job_id, user_id, lease_token, call_id, usage, state='done', result=None):
        with self.database.connect() as c:
            self.assert_lease(c, job_id, user_id, lease_token)
            changed = c.execute('''UPDATE product_material_calls SET state=%s,total_tokens=%s,usage=%s,result=%s,finished_at=now()
                WHERE id=%s AND job_id=%s AND lease_token=%s AND state='running' RETURNING id''',
                (state, max(0, int(usage.get('totalTokenCount', 0))), Jsonb(usage), Jsonb(result or {}), call_id, job_id, lease_token)).fetchone()
            if changed and state == 'unknown':
                c.execute("""UPDATE product_material_fragments SET state='unknown',updated_at=now()
                    WHERE job_id=%s AND id IN (SELECT jsonb_array_elements_text(fragment_ids)
                    FROM product_material_calls WHERE id=%s AND job_id=%s)""", (job_id, call_id, job_id))

    def cancel_unstarted_call(self, job_id, user_id, lease_token, call_id):
        """Release a reservation after a local guard fails, before any provider POST."""
        with self.database.connect() as c:
            self.assert_lease(c, job_id, user_id, lease_token)
            removed = c.execute("""DELETE FROM product_material_calls
                WHERE id=%s AND job_id=%s AND lease_token=%s AND state='running'
                RETURNING fragment_ids""", (call_id, job_id, lease_token)).fetchone()
            if removed:
                c.execute("""UPDATE product_material_fragments SET state='pending',updated_at=now()
                    WHERE job_id=%s AND id IN (SELECT jsonb_array_elements_text(%s::jsonb))
                    AND state='running'""", (job_id, Jsonb(removed['fragment_ids'])))

    def completed_call(self, job_id, user_id, fragment_ids):
        with self.database.connect() as c:
            row = c.execute('''SELECT k.* FROM product_material_calls k JOIN product_material_jobs j ON j.id=k.job_id
                WHERE k.job_id=%s AND j.user_id=%s AND k.state='done' AND k.fragment_ids=%s AND k.result<>'{}'::jsonb
                ORDER BY k.created_at DESC LIMIT 1''', (job_id, user_id, Jsonb(list(fragment_ids)))).fetchone()
        return row['result'] if row else None

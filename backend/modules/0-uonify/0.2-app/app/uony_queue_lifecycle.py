"""Fenced recovery of durable jobs; a started external call is never replayed."""
from contextlib import contextmanager
import logging
from threading import Event, Thread
from psycopg.types.json import Jsonb
from .uony_queue_state import safe_usage

# D8: available_at of a parked order (a finite sentinel: Python cannot load
# 'infinity'). The only definition; migration 124 repeats the literal and
# test_uony_followup_agent checks they match.
PARKED_UNTIL = '9999-12-31 00:00:00+00'


class QueueLifecycle:
    @staticmethod
    def release_parked(c, user_id):
        """D8: the account's parked order runs once nothing else of it is active."""
        c.execute("""UPDATE uony_conversation_jobs SET available_at=now(),updated_at=now()
            WHERE user_id=%s AND status='queued' AND available_at=%s::timestamptz
              AND NOT EXISTS (SELECT 1 FROM uony_conversation_jobs active
                WHERE active.user_id=%s AND active.status IN ('queued','running')
                  AND active.available_at<>%s::timestamptz)""",
            (user_id, PARKED_UNTIL, user_id, PARKED_UNTIL))

    def recover(self):
        # Start at expired running work, but lock only its account in this
        # query. Admission and deletion also lock users before jobs.
        with self.database.connect() as c:
            user=c.execute("""SELECT u.id FROM uony_conversation_jobs j
                JOIN users u ON u.id=j.user_id
                WHERE j.status='running'
                AND coalesce(j.lease_until,'-infinity'::timestamptz)<=now()
                ORDER BY coalesce(j.lease_until,'-infinity'::timestamptz),
                    j.user_id,j.request_id
                FOR UPDATE OF u SKIP LOCKED LIMIT 1""").fetchone()
            if not user:
                return False
            jobs=c.execute("""SELECT * FROM uony_conversation_jobs WHERE user_id=%s
                AND status='running' AND (lease_until IS NULL OR lease_until<=now()) FOR UPDATE""",
                (user['id'],)).fetchall()
            for job in jobs:
                started=job['provider_started_at'] is not None
                # Lote 6 (point 5, «Consultor google»): a written ADK turn commits its
                # effects only with its terminal state, so a lost worker left none:
                # capa 2's RETRY_LATER, never unknown. Voice handoffs keep their rule.
                written=started and job['engine']=='adk' and not c.execute('''SELECT 1
                    FROM uony_live_handoffs WHERE user_id=%s AND request_id=%s''',
                    (job['user_id'],job['request_id'])).fetchone()
                status=('unknown' if started and not written else
                        'error' if written or job['claim_count']>=self.recovery_policy.max_preparation_claims
                        else 'queued')
                code=('consumption_unknown' if status=='unknown' else
                      'preparation_interrupted' if status=='error' else None)
                usage=safe_usage(job['usage'])
                if started:
                    attempted=max(1,job['provider_attempt_count'],usage.get('attemptedCalls',0))
                    completed=min(attempted,max(job['provider_completed_count'],usage.get('calls',0)))
                    usage.update(attemptedCalls=attempted,calls=completed,
                                 uncertainCalls=max(1,usage.get('uncertainCalls',0),attempted-completed))
                c.execute("""INSERT INTO uony_conversation_recoveries
                    (user_id,request_id,claim_count,engine,outcome,expired_at)
                    VALUES(%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING""",
                    (job['user_id'],job['request_id'],job['claim_count'],
                     # The recovery log keeps «consumption unknown» for a started call (monitoring).
                     job['engine'],'unknown' if started else status,job['lease_until']))
                c.execute("""UPDATE uony_conversation_jobs SET status=%s,
                    error_code=%s,provider_error_code=%s,usage=%s,provisional_text='',
                    available_at=CASE WHEN %s='queued' THEN now()+
                        (claim_count*5)*interval '1 second' ELSE available_at END,
                    progress_stage=CASE WHEN %s='queued' THEN 'queued' ELSE progress_stage END,
                    progress_seq=progress_seq+1,
                    finished_at=CASE WHEN %s='queued' THEN NULL ELSE now() END,
                    lease_token=NULL,lease_owner=NULL,lease_until=NULL,updated_at=now()
                    WHERE user_id=%s AND request_id=%s""",
                    (status,code,'worker_lost' if written else job['provider_error_code'],Jsonb(usage),
                     status,status,status,job['user_id'],job['request_id']))
                if status in ('unknown','error'):
                    c.execute("""UPDATE uony_requests SET status='error',error_code=%s,
                        usage=%s
                        WHERE user_id=%s AND request_id=%s""",
                        (code,Jsonb(usage),job['user_id'],job['request_id']))
            if jobs:  # D8: work that ended here no longer holds a parked order.
                self.release_parked(c, user['id'])
            # A heartbeat may renew this lease after account selection but
            # before the job is locked. Let an idle batch try another account
            # rather than treating that race as an empty backlog.
            return True if jobs else None

    def release_orphans(self):
        """D8 (c): a parked order whose account has no other active work (a
        restored database copy, say) is released; the next claim takes it."""
        with self.database.connect() as c:
            c.execute("""UPDATE uony_conversation_jobs parked SET available_at=now(),updated_at=now()
                WHERE parked.status='queued' AND parked.available_at=%s::timestamptz
                  AND NOT EXISTS (SELECT 1 FROM uony_conversation_jobs active
                    WHERE active.user_id=parked.user_id AND active.status IN ('queued','running')
                      AND active.available_at<>%s::timestamptz)""", (PARKED_UNTIL, PARKED_UNTIL))

    def claim(self, worker_id):
        self.recover()
        self.release_orphans()  # Also on the worker's first claim after a start.
        # A competing claimer may finish after account selection used its
        # snapshot. Re-read in a new transaction instead of sleeping a second
        # while another account still has queued work.
        for _ in range(3):
            claimed, stale = self._claim_once(worker_id)
            if not stale:
                return claimed
        return None

    def recover_many(self, limit=32):
        """Drain a bounded idle batch; each account commits independently."""
        recovered=0
        for _ in range(limit):
            outcome=self.recover()
            if outcome is False:
                break
            if outcome is True:
                recovered+=1
        return recovered

    @contextmanager
    def keeping_lease(self, job):
        stop=Event()
        def pulse():
            while not stop.wait(self.recovery_policy.heartbeat_seconds):
                try:
                    if not self.renew_lease(job):
                        return
                except Exception as exc:
                    logging.error('Conversation lease renewal stopped: %s', type(exc).__name__)
                    return
        thread=Thread(target=pulse,daemon=True);thread.start()
        try:yield
        finally:stop.set();thread.join(timeout=1)

    def renew_lease(self, job):
        """Renew only the still-current lease; late workers cannot revive themselves."""
        with self.database.connect() as c:
            row=c.execute("""UPDATE uony_conversation_jobs
                SET lease_until=now()+%s*interval '1 second'
                WHERE user_id=%s AND request_id=%s AND status='running'
                AND lease_token=%s AND lease_until>now() RETURNING request_id""",
                (self.recovery_policy.lease_seconds,job['user_id'],job['request_id'],
                 job['lease_token'])).fetchone()
        return row is not None

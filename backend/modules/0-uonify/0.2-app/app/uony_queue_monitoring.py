"""Content-free, durable queue latency and recovery metrics scoped by account."""
from dataclasses import dataclass, asdict
from .uony_queue_state import configured_int


@dataclass(frozen=True)
class LatencyBudgets:
    # Pilot alert budgets, not an assertion about achieved service levels.
    queue_ms: int = 5000
    preparation_ms: int = 10000
    provider_ms: int = 45000
    checking_ms: int = 5000
    total_ms: int = 65000
    recovery_ms: int = 60000
    heartbeat_stale_seconds: int = 30

    def __post_init__(self):
        values = asdict(self)
        if any(type(value) is not int or not 1 <= value <= 3_600_000
               for key, value in values.items() if key != 'heartbeat_stale_seconds'):
            raise ValueError('Latency budgets must be positive bounded integer milliseconds')
        if not 15 <= self.heartbeat_stale_seconds <= 600:
            raise ValueError('heartbeat_stale_seconds must be between 15 and 600')

    @classmethod
    def from_environment(cls, env=None):
        defaults = asdict(cls())
        return cls(**{
            name: configured_int('UONIFY_QUEUE_' + (
                'HEARTBEAT_STALE_SECONDS' if name == 'heartbeat_stale_seconds'
                else name.removesuffix('_ms').upper() + '_BUDGET_MS'), default,
                15 if name == 'heartbeat_stale_seconds' else 1,
                600 if name == 'heartbeat_stale_seconds' else 3_600_000, env)
            for name, default in defaults.items()
        })

    def response(self):
        return {name: getattr(self, attr) for name, attr in (
            ('queueMs', 'queue_ms'), ('preparationMs', 'preparation_ms'),
            ('providerMs', 'provider_ms'), ('checkingMs', 'checking_ms'),
            ('totalMs', 'total_ms'), ('recoveryMs', 'recovery_ms'))}


def _ms(value):
    return None if value is None else max(0, round(float(value), 2))


def _stats(row):
    return {'samples': row['samples'], 'p95Ms': _ms(row['p95']),
            'p99Ms': _ms(row['p99']), 'maxMs': _ms(row['maximum'])}


def _scope(user, project_id):
    # Endpoint supplies server-authenticated identity, never model arguments.
    if not user or not user.get('id') or not user.get('google_subject'):
        raise ValueError('A server-authenticated user and Google subject are required')
    clause = 'j.user_id=%s AND j.google_subject=%s AND t.deleted_at IS NULL'
    params = (user['id'], user['google_subject'])
    if project_id is not None:
        clause += ' AND t.project_id=%s'
        params += (project_id,)
    return clause, params


def worker_health(c, budgets):
    # Only aggregate availability; never disclose worker ids or account details.
    rows = c.execute("""SELECT e.engine,
        count(*) FILTER (WHERE w.status<>'stopped' AND
            w.heartbeat_at>now()-%s*interval '1 second') AS healthy,
        count(*) FILTER (WHERE w.status<>'stopped' AND
            w.heartbeat_at<=now()-%s*interval '1 second') AS stale
        FROM uony_conversation_workers w
        CROSS JOIN LATERAL unnest(w.engines) e(engine)
        WHERE w.heartbeat_at>now()-interval '7 days' GROUP BY e.engine""",
        (budgets.heartbeat_stale_seconds, budgets.heartbeat_stale_seconds)).fetchall()
    return {engine: next(({'healthy': r['healthy'], 'stale': r['stale']}
                          for r in rows if r['engine'] == engine),
                         {'healthy': 0, 'stale': 0}) for engine in ('classic', 'adk')}


def queue_snapshot(c, user, *, project_id=None, window_seconds=3600, budgets=None):
    """No prompt/result content, bounded observation window, current backlog always included."""
    if type(window_seconds) is not int or not 60 <= window_seconds <= 86400:
        raise ValueError('window_seconds must be between 60 and 86400')
    budgets = budgets or LatencyBudgets.from_environment()
    scope, params = _scope(user, project_id)
    relation = ''' FROM uony_conversation_jobs j JOIN uony_threads t
        ON t.user_id=j.user_id AND t.id=j.thread_id WHERE ''' + scope
    # PostgreSQL's own clock is authoritative for admission, claim and recovery.
    measured_at = c.execute('SELECT now() AS at').fetchone()['at'].isoformat()
    timings = c.execute('''WITH observed AS (SELECT j.*''' + relation + '''
        AND j.created_at>=now()-%s*interval '1 second'), durations AS (
        SELECT v.metric,extract(epoch FROM v.duration)*1000 AS ms FROM observed j
        CROSS JOIN LATERAL (VALUES
            ('queueMs',j.first_claimed_at-j.created_at),
            ('preparationMs',coalesce(j.provider_started_at,j.finished_at)-j.last_claimed_at),
            ('providerMs',j.provider_returned_at-j.provider_started_at),
            ('checkingMs',j.finished_at-j.provider_returned_at),
            ('totalMs',j.finished_at-j.created_at)
        ) v(metric,duration) WHERE v.duration>=interval '0 seconds')
        SELECT metric,count(*) AS samples,
            percentile_cont(0.95) WITHIN GROUP (ORDER BY ms) AS p95,
            percentile_cont(0.99) WITHIN GROUP (ORDER BY ms) AS p99,
            max(ms) AS maximum FROM durations GROUP BY metric''',
        params + (window_seconds,)).fetchall()
    empty = {'samples': 0, 'p95Ms': None, 'p99Ms': None, 'maxMs': None}
    timing_metrics = {name: dict(empty) for name in budgets.response() if name != 'recoveryMs'}
    timing_metrics.update({r['metric']: _stats(r) for r in timings})
    states = c.execute('''SELECT j.engine,j.status,count(*) AS n,
        max(extract(epoch FROM now()-j.created_at)*1000) AS age,
        max(extract(epoch FROM now()-CASE j.progress_stage
            WHEN 'preparing' THEN j.last_claimed_at
            WHEN 'consulting_google' THEN j.provider_started_at
            WHEN 'checking_result' THEN j.provider_returned_at
            ELSE j.created_at END)*1000) AS stage_age,
        count(*) FILTER (WHERE j.status='running' AND
            coalesce(j.lease_until,'-infinity'::timestamptz)<=now()) AS expired,
        j.progress_stage''' + relation + ''' AND (j.created_at>=now()-%s*interval '1 second'
            OR j.status IN ('queued','running')) GROUP BY j.engine,j.status,j.progress_stage''',
        params + (window_seconds,)).fetchall()
    backlog = {'queued': 0, 'running': 0, 'expiredLeases': 0,
               'oldestQueuedMs': None, 'oldestRunningMs': None}
    counts = {}
    alerts = []
    for row in states:
        counts[row['status']] = counts.get(row['status'], 0) + row['n']
        if row['status'] not in ('queued', 'running'):
            continue
        backlog[row['status']] += row['n']
        backlog['expiredLeases'] += row['expired']
        age_key = 'oldestQueuedMs' if row['status'] == 'queued' else 'oldestRunningMs'
        backlog[age_key] = max(backlog[age_key] or 0, _ms(row['age']) or 0)
        metric = {'queued': 'queueMs', 'preparing': 'preparationMs',
                  'consulting_google': 'providerMs', 'checking_result': 'checkingMs'}.get(row['progress_stage'])
        if metric and (age := _ms(row['stage_age'])) is not None and age > budgets.response()[metric]:
            alerts.append({'code': 'active_stage_over_budget', 'metric': metric,
                           'engine': row['engine'], 'observedMs': age,
                           'budgetMs': budgets.response()[metric]})
    for metric, values in timing_metrics.items():
        for percentile in ('p95Ms', 'p99Ms'):
            if values[percentile] is not None and values[percentile] > budgets.response()[metric]:
                alerts.append({'code': 'percentile_over_budget', 'metric': metric,
                               'percentile': percentile, 'observedMs': values[percentile],
                               'budgetMs': budgets.response()[metric]})
    recovery = c.execute('''SELECT r.outcome,count(*) AS n,
        max(extract(epoch FROM r.recovered_at-r.expired_at)*1000) AS detection_ms,
        max(extract(epoch FROM r.resumed_at-r.expired_at)*1000) AS resume_ms,
        count(*) FILTER (WHERE r.resumed_at IS NOT NULL) AS resumed
        FROM uony_conversation_recoveries r JOIN uony_conversation_jobs j
        ON j.user_id=r.user_id AND j.request_id=r.request_id
        JOIN uony_threads t ON t.user_id=j.user_id AND t.id=j.thread_id
        WHERE ''' + scope + ''' AND r.recovered_at>=now()-%s*interval '1 second'
        GROUP BY r.outcome''', params + (window_seconds,)).fetchall()
    recovery_result = {'requeued': 0, 'unknown': 0, 'exhausted': 0, 'resumed': 0,
                       'maxDetectionMs': None, 'maxResumeMs': None}
    for row in recovery:
        recovery_result[{'queued': 'requeued', 'unknown': 'unknown', 'error': 'exhausted'}[row['outcome']]] = row['n']
        recovery_result['resumed'] += row['resumed']
        for key, column in (('maxDetectionMs', 'detection_ms'), ('maxResumeMs', 'resume_ms')):
            value = _ms(row[column])
            if value is not None:
                recovery_result[key] = max(recovery_result[key] or 0, value)
    if (recovery_result['maxResumeMs'] or 0) > budgets.recovery_ms:
        alerts.append({'code': 'recovery_over_budget', 'metric': 'recoveryMs',
                       'observedMs': recovery_result['maxResumeMs'], 'budgetMs': budgets.recovery_ms})
    health = worker_health(c, budgets)
    for engine in {row['engine'] for row in states if row['status'] == 'queued'}:
        if health[engine]['healthy'] == 0:
            alerts.append({'code': 'no_healthy_worker', 'engine': engine})
    if backlog['expiredLeases']:
        alerts.append({'code': 'expired_leases', 'count': backlog['expiredLeases']})
    return {'measuredAt': measured_at, 'windowSeconds': window_seconds,
            'budgetsMs': budgets.response(), 'timings': timing_metrics,
            'counts': counts, 'backlog': backlog, 'recovery': recovery_result,
            'workers': health, 'alerts': alerts}

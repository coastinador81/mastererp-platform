"""Private account rows only. External originals and shared configuration stay intact."""
from psycopg import sql
from psycopg.types.json import Jsonb
from fastapi import HTTPException


# Child-first order, including tables whose user_id is not a direct users FK.
# New private tables must be added deliberately; a restrictive FK aborts an
# incomplete purge rather than silently claiming success.
PRIVATE_TABLES = (
    'uony_creative_plans',
    'uony_assignment_material_jobs',
    'uony_structured_focus_expectations',
    'uony_assignment_focus_requests', 'uony_assignment_focus', 'uony_assignments',
    'uony_return_followups',
    'uony_thread_products',
    'uony_live_handoffs',
    'uony_live_turns',
    'uony_live_sessions',
    'uony_live_usage',
    'uony_live_pilot_admissions',
    'uony_conversation_jobs',
    'uony_product_proposals',
    'uony_product_intake_requests', 'uony_product_intakes',
    'google_setup_operations', 'onboarding_setup_states',
    'product_material_job_authorizations',
    'product_material_control_authorizations',
    'product_material_refreshes', 'product_material_controls', 'product_reasoning_jobs',
    'product_material_jobs', 'amazon_publish_followups', 'amazon_publish_attempts',
    'amazon_publish_media_verifications',
    'amazon_publish_approvals', 'amazon_publish_snapshots', 'product_requirement_schemas', 'product_revisions',
    'blender_jobs', 'blender_coordination_usage', 'blender_agents',
    'amazon_incident_requests', 'amazon_incident_submissions', 'amazon_incidents',
    'amazon_listing_snapshots', 'amazon_incident_checks', 'amazon_incident_sync',
    'uony_requests', 'uony_threads', 'uony_projects', 'uony_model_checks', 'uony_preferences',
    'products', 'google_billing_sync', 'google_billing_observations', 'drive_uploads', 'drive_materials',
    'drive_onboarding_preferences', 'drive_popup_flows', 'drive_oauth_attempts',
    'cloud_popup_flows', 'cloud_oauth_attempts', 'amazon_oauth_attempts',
    'erp_popup_flows', 'erp_oauth_attempts', 'uony_erp_refs',
    'google_drive_connections', 'google_cloud_connections', 'amazon_connections', 'erp_connections',
    'billing_subscriptions', 'billing_checkouts', 'subscription_selections',
    'access_periods', 'consent_acceptances', 'onboarding_profiles', 'sessions',
)


def counts(connection, user_id):
    result = {}
    for name, table in (('products', 'products'), ('conversations', 'uony_threads')):
        result[name] = connection.execute(sql.SQL('SELECT count(*) n FROM {} WHERE user_id=%s')
                                         .format(sql.Identifier(table)), (user_id,)).fetchone()['n']
    result['connections'] = sum(connection.execute(sql.SQL('SELECT count(*) n FROM {} WHERE user_id=%s')
        .format(sql.Identifier(table)), (user_id,)).fetchone()['n'] for table in (
            'google_drive_connections', 'google_cloud_connections', 'amazon_connections', 'blender_agents'))
    return result


def blockers(connection, user_id):
    result = []
    checks = (
        ('google_setup', 'google_setup_operations', "lease_until>now()"),
        ('google_costs', 'google_billing_sync', "lease_until>now()"),
        ('materials', 'product_material_jobs', "status='queued' OR (status='running' AND lease_until>now())"),
        ('reasoning', 'product_reasoning_jobs', "status='queued' OR (status='running' AND lease_until>now())"),
        ('blender', 'blender_jobs', "status='queued' OR (status='running' AND lease_expires_at>now())"),
        ('conversation', 'uony_requests', "status='running' AND created_at>now()-interval '4 minutes'"),
        ('live_voice', 'uony_live_sessions', "expires_at>now()"),
        ('amazon_publish', 'amazon_publish_attempts',
         "status='reserved' AND reserved_at>now()-interval '2 minutes'"),
        ('amazon_followup', 'amazon_publish_followups',
         "status='checking' AND started_at>now()-interval '2 minutes'"),
    )
    for code, table, condition in checks:
        n = connection.execute(sql.SQL('SELECT count(*) n FROM {} WHERE user_id=%s AND ({})')
            .format(sql.Identifier(table), sql.SQL(condition)), (user_id,)).fetchone()['n']
        if n:
            result.append({'code': code, 'count': n,
                'message': 'Hay una operación en curso. Espera a que termine antes de eliminar la cuenta.'})
    return result


def cancel_conversations(connection, user_id):
    """Fence pending/running chat before deleting its owner and credentials."""
    rows=connection.execute("""SELECT request_id,provider_started_at FROM uony_conversation_jobs
        WHERE user_id=%s AND status IN ('queued','running') FOR UPDATE""",
        (user_id,)).fetchall()
    for row in rows:
        unknown=bool(row['provider_started_at'])
        code='consumption_unknown' if unknown else 'cancelled'
        usage={'attemptedCalls':1,'uncertainCalls':1} if unknown else {'attemptedCalls':0,'uncertainCalls':0}
        connection.execute("""UPDATE uony_conversation_jobs SET status=%s,error_code=%s,
            usage=%s,lease_token=NULL,lease_owner=NULL,lease_until=NULL,updated_at=now()
            WHERE user_id=%s AND request_id=%s""",
            ('unknown' if unknown else 'cancelled',code,Jsonb(usage),user_id,row['request_id']))
        connection.execute("""UPDATE uony_requests SET status='error',error_code=%s,usage=%s
            WHERE user_id=%s AND request_id=%s""",
            (code,Jsonb(usage),user_id,row['request_id']))


def require_isolated_graph(connection, user_id):
    setup_mismatch = connection.execute('''SELECT 1 FROM google_setup_operations child
        JOIN google_setup_operations parent ON parent.id IN (child.retry_of,child.revision_of)
        WHERE child.user_id<>parent.user_id AND (child.user_id=%s OR parent.user_id=%s) LIMIT 1''',
        (user_id, user_id)).fetchone()
    if setup_mismatch:
        raise HTTPException(409, detail={'error': 'account_deletion_integrity',
            'message': 'No podemos comprobar que todos los datos pertenezcan a esta cuenta. La eliminación se ha detenido para revisarlo.'})
    # These child tables cascade from a job but also carry an independent owner.
    # Refuse a corrupt cross-account link before canceling billing or deleting.
    for table in ('product_material_controls', 'product_material_refreshes'):
        mismatch = connection.execute(sql.SQL('''SELECT 1 FROM {} child JOIN product_material_jobs parent
            ON parent.id=child.job_id WHERE child.user_id<>parent.user_id
            AND (child.user_id=%s OR parent.user_id=%s) LIMIT 1''').format(sql.Identifier(table)),
            (user_id, user_id)).fetchone()
        if mismatch:
            raise HTTPException(409, detail={'error': 'account_deletion_integrity',
                'message': 'No podemos comprobar que todos los datos pertenezcan a esta cuenta. La eliminación se ha detenido para revisarlo.'})


def purge(connection, user, oauth_browser_hash):
    user_id = user['id']
    require_isolated_graph(connection, user_id)
    connection.execute("SELECT set_config('uonify.deleting_user',%s,true)", (str(user_id),))
    connection.execute('''DELETE FROM billing_reminders WHERE subscription_id IN
        (SELECT stripe_id FROM billing_subscriptions WHERE user_id=%s)''', (user_id,))
    connection.execute('''DELETE FROM amazon_oauth_intents WHERE seller_id IN
        (SELECT seller_id FROM amazon_connections WHERE user_id=%s) OR browser_hash IN
        (SELECT browser_hash FROM amazon_oauth_attempts WHERE user_id=%s AND browser_hash IS NOT NULL)''',
        (user_id, user_id))
    if oauth_browser_hash:
        connection.execute('DELETE FROM oauth_attempts WHERE browser_hash=%s', (oauth_browser_hash,))
    for table in PRIVATE_TABLES:
        connection.execute(sql.SQL('DELETE FROM {} WHERE user_id=%s').format(sql.Identifier(table)), (user_id,))
    connection.execute('DELETE FROM users WHERE id=%s', (user_id,))

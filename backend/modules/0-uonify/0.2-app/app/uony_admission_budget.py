"""Daily request budget shared by written, followup and Live admissions."""
from uuid import UUID


def admission_budget(settings, user, project_id):
    """Only an explicitly allowed pilot account AND workspace project can rise."""
    limit = getattr(settings, 'test_daily_request_limit', 50)
    if type(limit) is not int or not 50 <= limit <= 200:
        return 50
    try:
        project = str(UUID(str(project_id)))
    except (ValueError, TypeError, AttributeError):
        return 50
    if (str(user['id']) not in getattr(settings, 'adk_pilot_user_ids', ())
            or project not in getattr(settings, 'test_project_ids', ())):
        return 50
    return limit


def daily_count(c, user):
    # A successful followup is represented in both tables: UNION counts it once.
    return c.execute('''SELECT count(*) AS n FROM (
        SELECT request_id FROM uony_requests WHERE user_id=%s
          AND model NOT IN ('uonify-guide','uonify-creative')
          AND created_at>now()-interval '1 day'
        UNION SELECT request_id FROM uony_written_followups WHERE user_id=%s
          AND created_at>now()-interval '1 day') requests''',
        (user['id'], user['id'])).fetchone()['n']

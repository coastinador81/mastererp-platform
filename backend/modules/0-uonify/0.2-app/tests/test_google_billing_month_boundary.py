from datetime import datetime, timezone
import pytest
from app.google_billing_reports import month_period, BillingReportError


def test_first_instant_of_month_waits_instead_of_creating_an_invalid_period():
    with pytest.raises(BillingReportError) as error:
        month_period(datetime(2026, 11, 1, 7, 0, 0, tzinfo=timezone.utc))
    assert error.value.code == 'period_not_ready'
    start, end = month_period(datetime(2026, 11, 1, 7, 0, 1, tzinfo=timezone.utc))
    assert start < end

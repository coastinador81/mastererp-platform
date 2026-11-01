import os
import uuid

import pytest


@pytest.fixture(scope="session")
def database_url() -> str | None:
    return os.environ.get("MASTERERP_TEST_DATABASE_URL")


@pytest.fixture(scope="session")
def requires_db(database_url):
    if not database_url:
        pytest.skip("MASTERERP_TEST_DATABASE_URL not set")
    os.environ["DATABASE_URL"] = database_url
    os.environ["AUTH_MODE"] = "local"
    os.environ["ALLOW_TENANT_SELF_REGISTRATION"] = "true"
    return database_url

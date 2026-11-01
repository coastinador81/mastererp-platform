import json
import os
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest

from tenant_security.auth import AuthContext
from tenant_security.http import HttpError, parse_body


def test_parse_body_invalid_json():
    with pytest.raises(HttpError) as exc:
        parse_body({"body": "not-json"})
    assert exc.value.status == 400


def test_auth_context_create_tenant_flag():
    os.environ["ALLOW_TENANT_SELF_REGISTRATION"] = "false"
    auth = AuthContext(user_id=uuid4(), email="a@b.c", groups=frozenset(), claims={})
    assert auth.can_create_tenant() is False
    auth_admin = AuthContext(user_id=uuid4(), email="a@b.c", groups=frozenset({"tenant.register"}), claims={})
    assert auth_admin.can_create_tenant() is True


@patch("tenant_security.db.load_database_secret")
def test_secrets_manager_failure(mock_secret):
    mock_secret.side_effect = HttpError(503, "Unable to load database credentials")
    from tenant_security.db import load_database_secret

    with pytest.raises(HttpError):
        load_database_secret()

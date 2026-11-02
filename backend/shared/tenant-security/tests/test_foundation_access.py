"""Unit contracts only; SQL/HTTP evidence is reported separately."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import Mock

SPEC = importlib.util.spec_from_file_location('foundation_access', Path(__file__).parents[1] / 'tenant_security/foundation_access.py')
access = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(access)
A = '71000000-0000-0000-0000-000000000001'
T = '72000000-0000-0000-0000-000000000001'
C = '75000000-0000-0000-0000-000000000001'


class FoundationAccessTests(unittest.TestCase):
    def test_combined_guard_is_parameterized_and_fail_closed(self):
        conn = Mock()
        for verdict in [False, None, 1, 'true']:
            conn.run.return_value = [[verdict]]
            with self.assertRaises(access.CapabilityDenied):
                access.require_capability(conn, module_code='uonify.core', permission_code='uonify.connections.manage')
        conn.run.return_value = [[True]]
        access.require_capability(conn, module_code='uonify.core', permission_code='uonify.connections.manage')
        self.assertEqual(conn.run.call_args.kwargs['module'], 'uonify.core')

    def test_context_rolls_back_on_authorization_failure(self):
        conn = Mock()
        conn.run.side_effect = [None, [['mastererp_app']], None, [[None]], None]
        with self.assertRaises(access.CapabilityDenied):
            with access.request_context(conn, issuer='https://trusted.invalid', subject='a',
                                        tenant_id=T, operation='connection.status', correlation_id=C):
                self.fail('Unauthorized body executed')
        self.assertEqual(conn.run.call_args.args[0], 'ROLLBACK')

    def test_context_rejects_admin_connection(self):
        conn = Mock()
        conn.run.side_effect = [None, [['postgres']], None]
        with self.assertRaisesRegex(RuntimeError, 'application_role_required'):
            with access.request_context(conn, issuer='https://trusted.invalid', subject='a',
                                        tenant_id=T, operation='read', correlation_id=C):
                self.fail('Admin connection accepted')
        self.assertEqual(conn.run.call_args.args[0], 'ROLLBACK')

    def test_context_sets_all_fields_and_always_rolls_back(self):
        conn = Mock()
        conn.run.side_effect = [None, [['mastererp_app']], None, [[A]], None, None]
        with access.request_context(conn, issuer='https://trusted.invalid', subject='a',
                                    tenant_id=T, operation='read', correlation_id=C):
            pass
        args = conn.run.call_args_list[-2].kwargs
        self.assertEqual(args, {'actor': A, 'tenant': T, 'operation': 'read', 'correlation': C})
        self.assertEqual(conn.run.call_args.args[0], 'ROLLBACK')

    def test_audit_has_fixed_fields_and_rejects_arbitrary_body(self):
        logger = Mock()
        access.audit_result(logger, actor_id=A, tenant_id=T, company_id=None,
                            operation='connection.status', result='denied', correlation_id=C)
        message = logger.info.call_args.args[0]
        self.assertNotIn('token', message)
        with self.assertRaises(TypeError):
            access.audit_result(logger, actor_id=A, tenant_id=T, company_id=None,
                                operation='read', result='succeeded', correlation_id=C, body='not-accepted')


if __name__ == '__main__':
    unittest.main()

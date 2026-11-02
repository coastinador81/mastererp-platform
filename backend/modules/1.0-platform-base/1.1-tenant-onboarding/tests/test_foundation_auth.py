"""Real signature validation with ephemeral test keys; no AWS or database calls."""
import json,os,time,unittest
from unittest.mock import patch,MagicMock
from uuid import uuid4
import jwt
from cryptography.hazmat.primitives.asymmetric import rsa
from tenant_security import auth
from tenant_security.http import HttpError
from tenant_onboarding.handlers.router import handle_admin_request

class FoundationAuthTests(unittest.TestCase):
    def setUp(self):
        self.env=patch.dict(os.environ,{"COGNITO_ISSUER":"https://issuer.example.invalid/pool","COGNITO_APP_CLIENT_ID":"test-client","ALLOW_TENANT_SELF_REGISTRATION":"false"})
        self.env.start();self.addCleanup(self.env.stop)
        self.key=rsa.generate_private_key(public_exponent=65537,key_size=2048)
        public=json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(self.key.public_key()))
        public.update(kid="test-key",use="sig")
        self.path=patch('tenant_security.auth.Path');self.mockpath=self.path.start();self.addCleanup(self.path.stop)
        self.mockpath.return_value.with_name.return_value.read_text.return_value=json.dumps({"keys":[public]})

    def token(self,**overrides):
        values={"iss":os.environ['COGNITO_ISSUER'],"client_id":"test-client","sub":"synthetic-subject","token_use":"access","iat":int(time.time()),"exp":int(time.time())+300}
        values.update(overrides)
        return jwt.encode(values,self.key,algorithm="RS256",headers={"kid":"test-key"})

    def event(self,token):
        return {"headers":{"authorization":"Bearer "+token},"rawPath":"/v1/onboarding/sessions/"+str(uuid4()),"requestContext":{"http":{"method":"GET"}}}

    def test_valid_access_signature(self):
        self.assertEqual(auth.validate_request(self.event(self.token()))['sub'],'synthetic-subject')

    def test_invalid_access_contract(self):
        for overrides in ({'token_use':'id'},{'client_id':'other'},{'iss':'https://other.invalid'},{'exp':1},{'sub':''}):
            with self.subTest(overrides=overrides),self.assertRaises(HttpError) as failure:
                auth.validate_request(self.event(self.token(**overrides)))
            self.assertEqual(failure.exception.status,401)

    def test_missing_token_never_opens_database(self):
        with patch('tenant_onboarding.handlers.router.db_connection') as database:
            self.assertEqual(handle_admin_request({'headers':{}})['statusCode'],401)
            database.assert_not_called()

    def test_inactive_or_unlinked_identity_is_403(self):
        connection=MagicMock();connection.execute.return_value.fetchone.return_value={'id':None}
        with patch('tenant_onboarding.handlers.router.db_connection') as database:
            database.return_value.__enter__.return_value=connection
            self.assertEqual(handle_admin_request(self.event(self.token()))['statusCode'],403)
        self.assertNotIn('email',connection.execute.call_args.args[0])

    def test_authorized_existing_session(self):
        connection=MagicMock();connection.execute.return_value.fetchone.return_value={'id':uuid4()}
        with patch('tenant_onboarding.handlers.router.db_connection') as database,patch('tenant_onboarding.handlers.router.sessions.get_session',return_value={'session':{'status':'started'}}):
            database.return_value.__enter__.return_value=connection
            self.assertEqual(handle_admin_request(self.event(self.token()))['statusCode'],200)
            self.assertEqual(database.call_count,1)

    def test_cognito_groups_do_not_grant_registration(self):
        context=auth.AuthContext(uuid4(),None,frozenset({'platform.admin','tenant.register'}),{})
        self.assertFalse(context.can_create_tenant());self.assertFalse(context.has_group('platform.admin'))

if __name__=='__main__':unittest.main()

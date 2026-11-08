"""Bandeja Amazon persistente; nunca confunde desconexión o lectura parcial con cero incidencias."""
from uuid import uuid4
from cryptography.fernet import Fernet, InvalidToken
from psycopg.types.json import Jsonb
from .amazon_provider import load_config
from .amazon_catalog import AmazonReadError, MARKETPLACE
from .amazon_listings_provider import AmazonListings, MARKETS
from .amazon_store import fail
from .products import require_access
from . import amazon_incidents_store as store


class AmazonIncidents:
    def __init__(self, settings, database, config=None, client_factory=None):
        self.settings, self.database = settings, database
        self.config = config or load_config(settings)
        self.client_factory = client_factory or AmazonListings
        self.cipher = Fernet(settings.encryption_key)

    def _scope(self, c, user_id, marketplace_id=None, write=False):
        if write:
            user = c.execute('SELECT * FROM users WHERE id=%s', (user_id,)).fetchone()
            if not user:
                fail('not_authenticated', 'Inicia sesión para continuar.', 401)
            require_access(c, user)
        account = c.execute('SELECT * FROM amazon_connections WHERE user_id=%s', (user_id,)).fetchone()
        market = marketplace_id or (account['marketplace_id'] if account else MARKETPLACE)
        if market not in MARKETS:
            fail('unsupported_marketplace', 'Selecciona un mercado europeo admitido por esta conexión.')
        return account, market

    def _client(self, account):
        if not account:
            fail('amazon_disconnected', 'Conecta Amazon para consultar y corregir las incidencias.', 409)
        client = self.client_factory(self.config)
        try:
            refresh = self.cipher.decrypt(account['refresh_encrypted'].encode()).decode()
        except (InvalidToken, ValueError):
            fail('amazon_reconnect', 'Vuelve a conectar Amazon para recuperar el acceso.', 409)
        client.authenticate(refresh)
        return client

    def get(self, user_id, incident_id):
        with self.database.connect() as c:
            return store.detail(store.get(c, user_id, incident_id))

    def listing(self, user_id, sku=None, status='active', marketplace_id=None):
        if status not in ('active', 'resolved', 'all'):
            fail('invalid_status', 'Selecciona un estado válido.')
        with self.database.connect() as c:
            account, market = self._scope(c, user_id, marketplace_id)
            connected = bool(account)
            if not account:
                previous = c.execute('''SELECT seller_id,marketplace_id FROM amazon_incident_sync WHERE user_id=%s'''
                    + (' AND marketplace_id=%s' if marketplace_id else '')
                    + ' ORDER BY last_checked_at DESC NULLS LAST,scan_started_at DESC NULLS LAST LIMIT 1',
                    (user_id, market) if marketplace_id else (user_id,)).fetchone()
                account = previous or {'seller_id': ''}
                if previous and not marketplace_id:
                    market = previous['marketplace_id']
            key = (user_id, account['seller_id'], market)
            state = c.execute('SELECT * FROM amazon_incident_sync WHERE user_id=%s AND seller_id=%s AND marketplace_id=%s', key).fetchone()
            if sku:
                checked = c.execute('''SELECT * FROM amazon_incident_checks WHERE user_id=%s AND seller_id=%s
                    AND marketplace_id=%s AND sku=%s''', (*key, sku)).fetchone()
                if checked:
                    state = {**checked, 'cursor': None}
            rows = c.execute('''SELECT * FROM amazon_incidents WHERE user_id=%s AND seller_id=%s'''
                + (' AND marketplace_id=%s' if marketplace_id else '') + ' ORDER BY first_seen_at DESC,id',
                key if marketplace_id else key[:2]).fetchall()
            scoped = [r for r in rows if sku is None or r['sku'] == sku]
            active = [r for r in scoped if r['status'] != 'resolved']
            selected = [r for r in scoped if status == 'all' or (r['status'] == 'resolved') == (status == 'resolved')]
            return {'incidents': [store.detail(r) for r in selected],
                    'summary': {'active': len(active), 'products': len({r['sku'] for r in active}),
                                'blocking': sum(r['severity'] == 'ERROR' for r in active),
                                'warnings': sum(r['severity'] == 'WARNING' for r in active)},
                    'sync': {'state': state['state'] if state else 'never',
                             'lastCheckedAt': store.iso(state['last_checked_at']) if state else None,
                             'message': ('Amazon está desconectado. Mostramos el último estado conocido.' if not connected
                                         else state['message'] if state else None),
                             'nextToken': state['cursor'] if state and connected else None,
                             'marketplaceId': market, 'marketplaceName': MARKETS[market],
                             'scope': 'sku' if sku else 'marketplace',
                             'knownMarketplaceIds': sorted({r['marketplace_id'] for r in scoped})},
                    'connection': {'connected': connected, 'marketplaceId': market, 'sellerId': account['seller_id'],
                                   'marketplaces': [{'id': k, 'name': v} for k, v in MARKETS.items()]}}

    def sync(self, user_id, sku=None, marketplace_id=None, cursor=None):
        with self.database.connect() as c:
            account, market = self._scope(c, user_id, marketplace_id, write=True)
            if not account:
                fail('amazon_disconnected', 'Conecta Amazon para comprobar las incidencias.', 409)
            key = (user_id, account['seller_id'], market)
            store.lock_account(c, *key)
            c.execute('''INSERT INTO amazon_incident_sync(user_id,seller_id,marketplace_id)
                VALUES(%s,%s,%s) ON CONFLICT DO NOTHING''', key)
            state = c.execute('''SELECT * FROM amazon_incident_sync WHERE user_id=%s AND seller_id=%s
                AND marketplace_id=%s FOR UPDATE''', key).fetchone()
            if cursor and (sku or state['cursor'] != cursor or not state['scan_started_at'] or
                           (store.now() - state['scan_started_at']).total_seconds() > 1800):
                fail('sync_cursor_expired', 'La consulta ha cambiado o caducado. Actualiza desde el principio.', 409)
            started = store.now()
            try:
                client = self._client(account)
                if sku:
                    snap = store.snapshot(c, *key, client.item(account['seller_id'], market, sku), started)
                    if not snap:
                        raise AmazonReadError('stale_listing_snapshot')
                    store.observe(c, *key, snap, reconcile=True)
                    result_state = {'state': 'ok', 'lastCheckedAt': store.iso(started), 'message': None, 'nextToken': None}
                else:
                    result_state = self._scan_page(c, key, client, state, cursor, started)
            except AmazonReadError:
                # Preserve previously known counts and all unresolved records on failure.
                message = 'No se ha podido comprobar Amazon. Conservamos las incidencias conocidas; vuelve a consultar.'
                result_state = {'state': 'error', 'lastCheckedAt': store.iso(state['last_checked_at']),
                                'message': message, 'nextToken': state['cursor']}
                if not sku:
                    c.execute('''UPDATE amazon_incident_sync SET state='error',message=%s
                        WHERE user_id=%s AND seller_id=%s AND marketplace_id=%s''', (message, *key))
            if sku:
                c.execute('''INSERT INTO amazon_incident_checks(user_id,seller_id,marketplace_id,sku,state,last_checked_at,message)
                    VALUES(%s,%s,%s,%s,%s,%s,%s) ON CONFLICT(user_id,seller_id,marketplace_id,sku)
                    DO UPDATE SET state=EXCLUDED.state,message=EXCLUDED.message,
                    last_checked_at=CASE WHEN EXCLUDED.state='ok' THEN EXCLUDED.last_checked_at
                    ELSE amazon_incident_checks.last_checked_at END''',
                    (*key, sku, result_state['state'], started if result_state['state'] == 'ok' else None, result_state['message']))
        result = self.listing(user_id, sku=sku, marketplace_id=market)
        result_state.update({'marketplaceId': market, 'marketplaceName': MARKETS[market], 'scope': 'sku' if sku else 'marketplace'})
        result['sync'] = result_state
        return result

    def _scan_page(self, c, key, client, state, cursor, started):
        scan_id = state['scan_id'] if cursor else uuid4()
        seen = state['seen_tokens'] if cursor else []
        page = client.search(key[1], key[2], state['page_token'] if cursor else None)
        for item in page['items']:
            snap = store.snapshot(c, *key, item, started, scan_id)
            if not snap:
                raise AmazonReadError('stale_listing_snapshot')
            store.observe(c, *key, snap, reconcile=False)
        next_page = page.get('pagination', {}).get('nextToken')
        if next_page and next_page in seen:
            raise AmazonReadError('repeated_listing_cursor')
        next_cursor = str(uuid4()) if next_page else None
        complete = not next_page
        total = page.get('numberOfResults')
        snapshots = c.execute('''SELECT * FROM amazon_listing_snapshots WHERE user_id=%s AND seller_id=%s
            AND marketplace_id=%s AND scan_id=%s''', (*key, scan_id)).fetchall()
        if complete and isinstance(total, int) and total > len(snapshots):
            # Amazon may truncate very large searches: never claim a complete zero-result scan.
            raise AmazonReadError('truncated_listing_search')
        if complete:
            for snap in snapshots:
                store.observe(c, *key, snap, reconcile=True)
        message = None if complete else 'Consulta parcial. Continúa para comprobar el resto del catálogo.'
        checked = started if complete else state['last_checked_at']
        c.execute('''UPDATE amazon_incident_sync SET state=%s,last_checked_at=%s,message=%s,
            scan_id=%s,cursor=%s,page_token=%s,seen_tokens=%s,scan_started_at=%s
            WHERE user_id=%s AND seller_id=%s AND marketplace_id=%s''',
            ('ok' if complete else 'partial', checked, message, scan_id, next_cursor, next_page,
             Jsonb([*seen, next_page] if next_page else []), state['scan_started_at'] if cursor else started, *key))
        return {'state': 'ok' if complete else 'partial', 'lastCheckedAt': store.iso(checked),
                'message': message, 'nextToken': next_cursor}

    def _fresh_context(self, c, user_id, incident_id):
        row = store.get(c, user_id, incident_id)
        account, market = self._scope(c, user_id, row['marketplace_id'], write=True)
        store.lock_account(c, user_id, row['seller_id'], market)
        row = store.get(c, user_id, incident_id, lock=True)
        client = self._client(account)
        started = store.now()
        item = client.item(row['seller_id'], market, row['sku'])
        snap = store.snapshot(c, user_id, row['seller_id'], market, item, started)
        if not snap:
            fail('stale_amazon_snapshot', 'Amazon ha devuelto una versión anterior. Vuelve a comprobarla.', 409)
        store.observe(c, user_id, row['seller_id'], market, snap, reconcile=True)
        row = store.get(c, user_id, incident_id, lock=True)
        schema = client.schema(row['seller_id'], market, store.product_type(item, market))
        context = {'incident': store.detail(row), 'attributes': item['attributes'],
                   'productType': store.product_type(item, market), 'snapshotVersion': snap['version'], **schema}
        return row, context, client, snap

    def context(self, user_id, incident_id):
        try:
            with self.database.connect() as c:
                return self._fresh_context(c, user_id, incident_id)[1]
        except AmazonReadError:
            fail('amazon_unavailable', 'No podemos recuperar el estado y los requisitos actuales de Amazon. Vuelve a intentarlo.', 503)

    def prepare(self, user_id, incident_id, revision, attributes, request_id, validator):
        from .amazon_incidents_corrections import prepare
        return prepare(self, user_id, incident_id, revision, attributes, request_id, validator)

    def submit(self, user_id, incident_id, revision, request_id, validator):
        from .amazon_incidents_corrections import submit
        return submit(self, user_id, incident_id, revision, request_id, validator)

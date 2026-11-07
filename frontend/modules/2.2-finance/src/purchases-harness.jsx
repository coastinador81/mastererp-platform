import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {createRoot} from 'react-dom/client';
import Purchases from '../2.2.1-administration/2.2.1.2-gestion-compras/screens/purchases/Purchases.jsx';
import {DEMO, demoDetails, demoList, demoOpciones, demoOrigins} from '../2.2.1-administration/2.2.1.2-gestion-compras/screens/purchases/purchasesDemoFixtures.mjs';
import './finance.css';

const SCENARIO_KEY = 'mastererp.purchases.harness.scenario';
const MOBILE_KEY = 'mastererp.purchases.harness.mobile';

const scenarios = {
  'demo-catalog': 'Catálogo de compras ficticias (recomendado)',
  'list-with-rows': 'Listado con registros (pag. 1)',
  'list-empty-first': 'Primera página vacía',
  'list-empty-after-page': 'Página posterior vacía → regreso',
  create: 'Creación (mock)',
  detail: 'Detalle con referencia y versión',
  edit: 'Edición',
  derived: 'Detalle con documento derivado (solo lectura)',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parsePath(hash) {
  const path = (hash || '').replace(/^#/, '') || '/modulos/finanzas/administracion/solicitudes-compra';
  const kinds = ['solicitudes-compra', 'ordenes-compra', 'facturas-proveedores'];
  const kind = kinds.find(k => path.includes(k)) || 'solicitudes-compra';
  const base = '/modulos/finanzas/administracion/' + kind;
  return {path, base, kind};
}

function mockGet(url) {
  const u = new URL(url);
  const scenario = sessionStorage.getItem(SCENARIO_KEY) || 'demo-catalog';
  const details = demoDetails(scenario);
  const segs = u.pathname.split('/').filter(Boolean);
  const last = segs[segs.length - 1];
  const secondLast = segs[segs.length - 2];
  const limit = u.searchParams.get('limit') || '';
  const after = u.searchParams.get('after') || '';

  if (secondLast === 'compras' && last === 'opciones') {
    return Promise.resolve(demoOpciones());
  }

  if ((secondLast === 'solicitudes' || secondLast === 'ordenes' || secondLast === 'facturas') && UUID_RE.test(last)) {
    const d = details[last];
    if (!d) {
      return Promise.reject(Object.assign(new Error('No encontrado'), {status: 404}));
    }
    return Promise.resolve(d);
  }

  if (secondLast === 'compras' && last === 'solicitudes') {
    if (limit === '100') {
      return Promise.resolve(demoOrigins('solicitudes'));
    }
    return Promise.resolve(demoList('solicitudes', scenario, after));
  }

  if (secondLast === 'compras' && last === 'ordenes') {
    if (limit === '100') {
      return Promise.resolve(demoOrigins('ordenes'));
    }
    return Promise.resolve(demoList('ordenes', scenario, after));
  }

  if (secondLast === 'compras' && last === 'facturas') {
    if (limit === '100') {
      return Promise.resolve(demoOrigins('ordenes'));
    }
    return Promise.resolve(demoList('facturas', scenario, after));
  }

  console.warn('[purchases-harness] GET no mock:', url);
  return Promise.reject(Object.assign(new Error('Not mocked'), {status: 404}));
}

function mockRequest(url, options = {}) {
  if (!options.method || options.method === 'GET') {
    return mockGet(url);
  }
  const u = new URL(url);
  const segs = u.pathname.split('/').filter(Boolean);
  const id = segs[segs.length - 1];
  const collection = segs[segs.length - 2];
  if (options.method === 'POST' && (collection === 'solicitudes' || collection === 'ordenes' || collection === 'facturas')) {
    const body = JSON.parse(options.body || '{}');
    const newId = '88888888-8888-8888-8888-888888888888';
    return Promise.resolve({
      data: {id: newId, ...body.documento, version: '1'},
    });
  }
  if (options.method === 'PATCH' && (collection === 'solicitudes' || collection === 'ordenes' || collection === 'facturas')) {
    const body = JSON.parse(options.body || '{}');
    const nextVer = String(Number(body.version ?? 1) + 1);
    return Promise.resolve({
      data: {id, ...body.documento, version: nextVer},
    });
  }
  return Promise.reject(Object.assign(new Error('Method not mocked'), {status: 500}));
}

function kindFromPath(path) {
  const {kind} = parsePath(path);
  return kind;
}

function HarnessChrome({scenario, setScenario, mobile, setMobile, path, setPath}) {
  return (
    <div
      className="panel"
      style={{
        margin: '12px auto',
        maxWidth: mobile ? 390 : 960,
        padding: 12,
        border: '1px dashed var(--finance-control-border)',
      }}>
      <h2 style={{marginTop: 0, fontSize: 16}}>Harness aislado — Purchases.jsx (fixtures)</h2>
      <p className="muted" style={{marginTop: 0}}>
        Catálogo ficticio: SOL-DEMO-1001 → OC-DEMO-1001 → FAC-DEMO-1001; SOL-DEMO-2000 sin orden (crear orden). No sustituye DEV.
      </p>
      <div className="supplier-fields" style={{display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end'}}>
        <label>
          Escenario
          <select
            aria-label="Escenario de prueba"
            value={scenario}
            onChange={e => {
              sessionStorage.setItem(SCENARIO_KEY, e.target.value);
              setScenario(e.target.value);
              const {base} = parsePath(path);
              setPath(base);
            }}>
            {Object.entries(scenarios).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Módulo (tipo)
          <select
            aria-label="Tipo de documento"
            value={kindFromPath(path)}
            onChange={e => {
              setPath('/modulos/finanzas/administracion/' + e.target.value);
            }}>
            <option value="solicitudes-compra">Solicitudes de compra</option>
            <option value="ordenes-compra">Órdenes</option>
            <option value="facturas-proveedores">Facturas de proveedores</option>
          </select>
        </label>
        <label style={{display: 'flex', gap: 8, alignItems: 'center'}}>
          <input
            type="checkbox"
            checked={mobile}
            onChange={e => {
              setMobile(e.target.checked);
              sessionStorage.setItem(MOBILE_KEY, e.target.checked ? '1' : '0');
            }}
          />
          Vista estrecha (≈ móvil)
        </label>
      </div>
      <p className="muted" style={{fontSize: 12}}>
        Atajos numerados cargan ruta + escenario. Teclado: Tab entre controles; en listado usar botones Ver detalle / paginación.
      </p>
      <div style={{display: 'flex', flexWrap: 'wrap', gap: 8}}>
        <button type="button" className="secondary" onClick={() => {sessionStorage.setItem(SCENARIO_KEY, 'demo-catalog'); setScenario('demo-catalog'); setPath('/modulos/finanzas/administracion/solicitudes-compra');}}>
          0 · Catálogo demo
        </button>
        <button type="button" className="secondary" onClick={() => {sessionStorage.setItem(SCENARIO_KEY, 'demo-catalog'); setScenario('demo-catalog'); setPath('/modulos/finanzas/administracion/solicitudes-compra');}}>
          1 · Solicitudes · listado
        </button>
        <button type="button" className="secondary" onClick={() => {sessionStorage.setItem(SCENARIO_KEY, 'list-empty-first'); setScenario('list-empty-first'); setPath('/modulos/finanzas/administracion/solicitudes-compra');}}>
          2 · Solicitudes · vacío p.1
        </button>
        <button type="button" className="secondary" onClick={() => {sessionStorage.setItem(SCENARIO_KEY, 'list-empty-after-page'); setScenario('list-empty-after-page'); setPath('/modulos/finanzas/administracion/solicitudes-compra');}}>
          3 · Solicitudes · vacío p.2
        </button>
        <button type="button" className="secondary" onClick={() => {sessionStorage.setItem(SCENARIO_KEY, 'create'); setScenario('create'); setPath('/modulos/finanzas/administracion/solicitudes-compra/nuevo');}}>
          4 · Solicitudes · crear
        </button>
        <button type="button" className="secondary" onClick={() => {sessionStorage.setItem(SCENARIO_KEY, 'demo-catalog'); setScenario('demo-catalog'); setPath('/modulos/finanzas/administracion/solicitudes-compra/' + DEMO.solA);}}>
          5 · Solicitudes · detalle
        </button>
        <button type="button" className="secondary" onClick={() => {sessionStorage.setItem(SCENARIO_KEY, 'demo-catalog'); setScenario('demo-catalog'); setPath('/modulos/finanzas/administracion/solicitudes-compra/' + DEMO.solA + '/editar');}}>
          6 · Solicitudes · editar
        </button>
        <button type="button" className="secondary" onClick={() => {sessionStorage.setItem(SCENARIO_KEY, 'demo-catalog'); setScenario('demo-catalog'); setPath('/modulos/finanzas/administracion/ordenes-compra');}}>
          7 · Órdenes · listado
        </button>
        <button type="button" className="secondary" onClick={() => {sessionStorage.setItem(SCENARIO_KEY, 'demo-catalog'); setScenario('demo-catalog'); setPath('/modulos/finanzas/administracion/ordenes-compra/nuevo');}}>
          8 · Órdenes · crear
        </button>
        <button type="button" className="secondary" onClick={() => {sessionStorage.setItem(SCENARIO_KEY, 'demo-catalog'); setScenario('demo-catalog'); setPath('/modulos/finanzas/administracion/ordenes-compra/' + DEMO.ordA);}}>
          9 · Órdenes · detalle
        </button>
        <button type="button" className="secondary" onClick={() => {sessionStorage.setItem(SCENARIO_KEY, 'demo-catalog'); setScenario('demo-catalog'); setPath('/modulos/finanzas/administracion/facturas-proveedores');}}>
          10 · Facturas · listado
        </button>
        <button type="button" className="secondary" onClick={() => {sessionStorage.setItem(SCENARIO_KEY, 'demo-catalog'); setScenario('demo-catalog'); setPath('/modulos/finanzas/administracion/facturas-proveedores/nuevo');}}>
          11 · Facturas · crear
        </button>
        <button type="button" className="secondary" onClick={() => {sessionStorage.setItem(SCENARIO_KEY, 'derived'); setScenario('derived'); setPath('/modulos/finanzas/administracion/facturas-proveedores/' + DEMO.facA);}}>
          12 · Facturas · derivado
        </button>
      </div>
    </div>
  );
}

function App() {
  const [path, setPath] = useState(
    () => window.location.hash.replace(/^#/, '') || '/modulos/finanzas/administracion/solicitudes-compra'
  );
  const [scenario, setScenario] = useState(() => sessionStorage.getItem(SCENARIO_KEY) || 'demo-catalog');
  const [mobile, setMobile] = useState(() => sessionStorage.getItem(MOBILE_KEY) === '1');

  useEffect(() => {
    const onHash = () => setPath(window.location.hash.replace(/^#/, '') || '/modulos/finanzas/administracion/solicitudes-compra');
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const navigate = useCallback(to => {
    const p = to.startsWith('/') ? to : '/' + to;
    window.location.hash = '#' + p;
  }, []);

  const workspace = useMemo(
    () => ({
      tenant: DEMO.tenant,
      company: DEMO.company,
      context: {
        permissions: ['administration.purchases.read', 'administration.purchases.write'],
        modules: ['erp.finance'],
        companies: [{id: CID, name: 'Empresa ficticia QA'}],
      },
      request: mockRequest,
      denied: () => {},
    }),
    []
  );

  const capacity = kindFromPath(path);

  return (
    <div style={{maxWidth: mobile ? 420 : 1100, margin: '0 auto', padding: '0 8px 32px'}}>
      <HarnessChrome {...{scenario, setScenario, mobile, setMobile, path, setPath}} />
      <Purchases workspace={workspace} capacity={capacity} path={path} navigate={navigate} />
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);

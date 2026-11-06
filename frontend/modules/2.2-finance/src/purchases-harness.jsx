import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {createRoot} from 'react-dom/client';
import Purchases from '../2.2.1-administration/2.2.1.2-gestion-compras/screens/purchases/Purchases.jsx';
import './finance.css';

const SCENARIO_KEY = 'mastererp.purchases.harness.scenario';
const MOBILE_KEY = 'mastererp.purchases.harness.mobile';

/** UUIDs fijos solo para el harness (fixtures; no son datos reales). */
const TID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const P1 = '11111111-1111-1111-1111-111111111111';
const S_A = '22222222-2222-2222-2222-222222222222';
const S_B = '33333333-3333-3333-3333-333333333333';
const O_FROM_S = '44444444-4444-4444-4444-444444444444';
const F_FROM_O = '55555555-5555-5555-5555-555555555555';

const scenarios = {
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

const solicitudLine = [{descripcion: 'Servicio ficticio', cantidad: '2', precio_unitario: '10.00', total: '20.00'}];
const ordenLine = [{descripcion: 'Ítem ficticio desde solicitud', cantidad: '1', precio_unitario: '15.00', total: '15.00'}];

function buildDetails(scenario) {
  const derivedEditable = scenario !== 'derived';
  return {
    [S_A]: {
      data: {
        id: S_A,
        proveedor_id: P1,
        proveedor: 'Proveedor ficticio Alpha',
        origen_id: '',
        fecha: '2026-11-01',
        numero: 'SOL-HARNESS-1',
        serie: 'A',
        moneda: 'VES',
        total: '20.00',
        moneda_base: 'VES',
        total_base: '20.00',
        tipo_cambio: '1',
        cambio_fecha: '2026-11-01',
        cambio_fuente: 'misma moneda',
        version: '3',
        lineas: solicitudLine,
        editable: true,
      },
    },
    [S_B]: {
      data: {
        id: S_B,
        proveedor_id: P1,
        proveedor: 'Proveedor ficticio Alpha',
        origen_id: '',
        fecha: '2026-11-02',
        numero: 'SOL-HARNESS-2',
        serie: 'A',
        moneda: 'VES',
        total: '30.00',
        moneda_base: 'VES',
        total_base: '30.00',
        tipo_cambio: '1',
        cambio_fecha: '2026-11-02',
        cambio_fuente: 'misma moneda',
        version: '1',
        lineas: solicitudLine,
        editable: true,
      },
    },
    [O_FROM_S]: {
      data: {
        id: O_FROM_S,
        proveedor_id: P1,
        proveedor: 'Proveedor ficticio Alpha',
        origen_id: S_A,
        fecha: '2026-11-03',
        numero: 'OC-HARNESS-1',
        serie: 'B',
        moneda: 'VES',
        total: '15.00',
        moneda_base: 'VES',
        total_base: '15.00',
        tipo_cambio: '1',
        cambio_fecha: '2026-11-03',
        cambio_fuente: 'misma moneda',
        version: '2',
        lineas: ordenLine,
        editable: true,
      },
    },
    [F_FROM_O]: {
      data: {
        id: F_FROM_O,
        proveedor_id: P1,
        proveedor: 'Proveedor ficticio Alpha',
        origen_id: O_FROM_S,
        fecha: '2026-11-04',
        numero: 'FAC-HARNESS-1',
        serie: 'C',
        moneda: 'VES',
        total: '15.00',
        moneda_base: 'VES',
        total_base: '15.00',
        tipo_cambio: '1',
        cambio_fecha: '2026-11-04',
        cambio_fuente: 'misma moneda',
        version: '1',
        lineas: ordenLine,
        editable: derivedEditable,
      },
    },
  };
}

function listPayload(collection, scenario, after) {
  const rowS = (id, num, total) => ({
    id,
    fecha: '2026-11-01',
    numero: num,
    proveedor: 'Proveedor ficticio Alpha',
    moneda: 'VES',
    total,
  });

  if (collection === 'solicitudes') {
    if (scenario === 'list-empty-first') {
      return {data: {items: [], next_cursor: ''}};
    }
    if (scenario === 'list-empty-after-page') {
      if (!after) {
        return {data: {items: [rowS(S_A, 'SOL-HARNESS-1', '20.00')], next_cursor: 'c2'}};
      }
      if (after === 'c2') {
        return {data: {items: [], next_cursor: ''}};
      }
    }
    if (!after) {
      return {
        data: {
          items: [rowS(S_A, 'SOL-HARNESS-1', '20.00'), rowS(S_B, 'SOL-HARNESS-2', '30.00')],
          next_cursor: 'c2',
        },
      };
    }
    if (after === 'c2') {
      return {
        data: {
          items: [{...rowS(S_B, 'SOL-HARNESS-3', '40.00'), id: '77777777-7777-7777-7777-777777777777', proveedor: 'Proveedor ficticio Beta'}],
          next_cursor: '',
        },
      };
    }
    return {data: {items: [], next_cursor: ''}};
  }

  if (collection === 'ordenes') {
    const base = listPayload('solicitudes', scenario, after);
    return {
      data: {
        items: (base.data.items || []).map(r => ({
          ...r,
          numero: String(r.numero || '').replace(/^SOL/, 'OC') || 'OC-HARNESS',
        })),
        next_cursor: base.data.next_cursor,
      },
    };
  }

  if (collection === 'facturas') {
    const base = listPayload('solicitudes', scenario, after);
    return {
      data: {
        items: (base.data.items || []).map(r => ({
          ...r,
          numero: String(r.numero || '').replace(/^SOL/, 'FAC') || 'FAC-HARNESS',
        })),
        next_cursor: base.data.next_cursor,
      },
    };
  }

  return {data: {items: [], next_cursor: ''}};
}

function mockGet(url) {
  const u = new URL(url);
  const scenario = sessionStorage.getItem(SCENARIO_KEY) || 'list-with-rows';
  const details = buildDetails(scenario);
  const segs = u.pathname.split('/').filter(Boolean);
  const last = segs[segs.length - 1];
  const secondLast = segs[segs.length - 2];
  const limit = u.searchParams.get('limit') || '';
  const after = u.searchParams.get('after') || '';

  const opciones = {
    data: {
      moneda_base: 'VES',
      monedas: [{codigo: 'VES'}, {codigo: 'USD'}],
      proveedores: [
        {id: P1, codigo: 'P-001', nombre: 'Proveedor ficticio Alpha'},
        {id: '66666666-6666-6666-6666-666666666666', codigo: 'P-002', nombre: 'Proveedor ficticio Beta'},
      ],
    },
  };

  if (secondLast === 'compras' && last === 'opciones') {
    return Promise.resolve(opciones);
  }

  /* Detalle: /compras/{solicitudes|ordenes|facturas}/{uuid} */
  if ((secondLast === 'solicitudes' || secondLast === 'ordenes' || secondLast === 'facturas') && UUID_RE.test(last)) {
    const d = details[last];
    if (!d) {
      return Promise.reject(Object.assign(new Error('No encontrado'), {status: 404}));
    }
    return Promise.resolve(d);
  }

  /* Listado: limit 10; orígenes en formulario: limit 100 */
  if (secondLast === 'compras' && last === 'solicitudes') {
    if (limit === '100') {
      return Promise.resolve({
        data: {
          items: [
            {id: S_A, fecha: '2026-11-01', numero: 'SOL-HARNESS-1', proveedor: 'Proveedor ficticio Alpha', moneda: 'VES', total: '20.00'},
            {id: S_B, fecha: '2026-11-02', numero: 'SOL-HARNESS-2', proveedor: 'Proveedor ficticio Alpha', moneda: 'VES', total: '30.00'},
          ],
          next_cursor: '',
        },
      });
    }
    return Promise.resolve(listPayload('solicitudes', scenario, after));
  }

  if (secondLast === 'compras' && last === 'ordenes') {
    if (limit === '100') {
      return Promise.resolve({
        data: {
          items: [{id: O_FROM_S, fecha: '2026-11-03', numero: 'OC-HARNESS-1', proveedor: 'Proveedor ficticio Alpha', moneda: 'VES', total: '15.00'}],
          next_cursor: '',
        },
      });
    }
    return Promise.resolve(listPayload('ordenes', scenario, after));
  }

  if (secondLast === 'compras' && last === 'facturas') {
    if (limit === '100') {
      return Promise.resolve({
        data: {
          items: [{id: O_FROM_S, fecha: '2026-11-03', numero: 'OC-HARNESS-1', proveedor: 'Proveedor ficticio Alpha', moneda: 'VES', total: '15.00'}],
          next_cursor: '',
        },
      });
    }
    return Promise.resolve(listPayload('facturas', scenario, after));
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
        Solo para validación visual; no sustituye DEV ni la app con autenticación real. Los datos son ficticios.
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
            <option value="ordenes-compra">Órdenes de compra</option>
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
        <button type="button" className="secondary" onClick={() => {sessionStorage.setItem(SCENARIO_KEY, 'list-with-rows'); setScenario('list-with-rows'); setPath('/modulos/finanzas/administracion/solicitudes-compra');}}>
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
        <button type="button" className="secondary" onClick={() => {sessionStorage.setItem(SCENARIO_KEY, 'detail'); setScenario('detail'); setPath('/modulos/finanzas/administracion/solicitudes-compra/' + S_A);}}>
          5 · Solicitudes · detalle
        </button>
        <button type="button" className="secondary" onClick={() => {sessionStorage.setItem(SCENARIO_KEY, 'edit'); setScenario('edit'); setPath('/modulos/finanzas/administracion/solicitudes-compra/' + S_A + '/editar');}}>
          6 · Solicitudes · editar
        </button>
        <button type="button" className="secondary" onClick={() => {sessionStorage.setItem(SCENARIO_KEY, 'list-with-rows'); setScenario('list-with-rows'); setPath('/modulos/finanzas/administracion/ordenes-compra');}}>
          7 · Órdenes · listado
        </button>
        <button type="button" className="secondary" onClick={() => {sessionStorage.setItem(SCENARIO_KEY, 'create'); setScenario('create'); setPath('/modulos/finanzas/administracion/ordenes-compra/nuevo');}}>
          8 · Órdenes · crear
        </button>
        <button type="button" className="secondary" onClick={() => {sessionStorage.setItem(SCENARIO_KEY, 'detail'); setScenario('detail'); setPath('/modulos/finanzas/administracion/ordenes-compra/' + O_FROM_S);}}>
          9 · Órdenes · detalle
        </button>
        <button type="button" className="secondary" onClick={() => {sessionStorage.setItem(SCENARIO_KEY, 'list-with-rows'); setScenario('list-with-rows'); setPath('/modulos/finanzas/administracion/facturas-proveedores');}}>
          10 · Facturas · listado
        </button>
        <button type="button" className="secondary" onClick={() => {sessionStorage.setItem(SCENARIO_KEY, 'create'); setScenario('create'); setPath('/modulos/finanzas/administracion/facturas-proveedores/nuevo');}}>
          11 · Facturas · crear
        </button>
        <button type="button" className="secondary" onClick={() => {sessionStorage.setItem(SCENARIO_KEY, 'derived'); setScenario('derived'); setPath('/modulos/finanzas/administracion/facturas-proveedores/' + F_FROM_O);}}>
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
  const [scenario, setScenario] = useState(() => sessionStorage.getItem(SCENARIO_KEY) || 'list-with-rows');
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
      tenant: TID,
      company: CID,
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

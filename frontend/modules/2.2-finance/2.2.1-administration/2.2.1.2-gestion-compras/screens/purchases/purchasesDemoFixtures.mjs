/**
 * Compras ficticias solo para harness / pruebas locales. No son datos reales ni DEV.
 * Cadena de ejemplo: solicitud → orden → factura (una por nivel).
 */
export const DEMO = {
  tenant: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  company: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  proveedor: '11111111-1111-1111-1111-111111111111',
  proveedorBeta: '66666666-6666-6666-6666-666666666666',
  solA: '22222222-2222-2222-2222-222222222222',
  solB: '33333333-3333-3333-3333-333333333333',
  solLibre: 'aaaaaaaa-aaaa-aaaa-aaaa-000000000001',
  ordA: '44444444-4444-4444-4444-444444444444',
  ordB: 'bbbbbbbb-bbbb-bbbb-bbbb-000000000002',
  facA: '55555555-5555-5555-5555-555555555555',
};

const lineSol = [{descripcion: 'Insumos de oficina (ficticio)', cantidad: '4', precio_unitario: '25.00', total: '100.00'}];
const lineSolB = [{descripcion: 'Mantenimiento preventivo (ficticio)', cantidad: '1', precio_unitario: '350.00', total: '350.00'}];
const lineOrd = [{descripcion: 'Insumos de oficina (desde solicitud)', cantidad: '4', precio_unitario: '25.00', total: '100.00'}];

function row({id, fecha, numero, proveedor, total}) {
  return {id, fecha, numero, proveedor, moneda: 'VES', total};
}

export function demoOpciones() {
  return {
    data: {
      moneda_base: 'VES',
      monedas: [{codigo: 'VES'}, {codigo: 'USD'}],
      proveedores: [
        {id: DEMO.proveedor, codigo: 'P-DEMO-01', nombre: 'Proveedor ficticio Alpha'},
        {id: DEMO.proveedorBeta, codigo: 'P-DEMO-02', nombre: 'Proveedor ficticio Beta'},
      ],
    },
  };
}

export function demoDetails(scenario) {
  const facturaNoEditable = scenario === 'derived';
  return {
    [DEMO.solA]: {
      data: {
        id: DEMO.solA,
        proveedor_id: DEMO.proveedor,
        proveedor: 'Proveedor ficticio Alpha',
        origen_id: '',
        fecha: '2026-11-01',
        numero: 'SOL-DEMO-1001',
        serie: 'A',
        moneda: 'VES',
        total: '100.00',
        moneda_base: 'VES',
        total_base: '100.00',
        tipo_cambio: '1',
        cambio_fecha: '2026-11-01',
        cambio_fuente: 'misma moneda',
        version: '2',
        lineas: lineSol,
        editable: true,
      },
    },
    [DEMO.solB]: {
      data: {
        id: DEMO.solB,
        proveedor_id: DEMO.proveedorBeta,
        proveedor: 'Proveedor ficticio Beta',
        origen_id: '',
        fecha: '2026-11-05',
        numero: 'SOL-DEMO-1002',
        serie: 'B',
        moneda: 'VES',
        total: '350.00',
        moneda_base: 'VES',
        total_base: '350.00',
        tipo_cambio: '1',
        cambio_fecha: '2026-11-05',
        cambio_fuente: 'misma moneda',
        version: '1',
        lineas: lineSolB,
        editable: true,
      },
    },
    [DEMO.solLibre]: {
      data: {
        id: DEMO.solLibre,
        proveedor_id: DEMO.proveedor,
        proveedor: 'Proveedor ficticio Alpha',
        origen_id: '',
        fecha: '2026-11-07',
        numero: 'SOL-DEMO-2000',
        serie: 'C',
        moneda: 'VES',
        total: '80.00',
        moneda_base: 'VES',
        total_base: '80.00',
        tipo_cambio: '1',
        cambio_fecha: '2026-11-07',
        cambio_fuente: 'misma moneda',
        version: '1',
        lineas: [{descripcion: 'Material fungible (ficticio)', cantidad: '2', precio_unitario: '40.00', total: '80.00'}],
        editable: true,
      },
    },
    [DEMO.ordA]: {
      data: {
        id: DEMO.ordA,
        proveedor_id: DEMO.proveedor,
        proveedor: 'Proveedor ficticio Alpha',
        origen_id: DEMO.solA,
        fecha: '2026-11-02',
        numero: 'OC-DEMO-1001',
        serie: 'OC',
        moneda: 'VES',
        total: '100.00',
        moneda_base: 'VES',
        total_base: '100.00',
        tipo_cambio: '1',
        cambio_fecha: '2026-11-02',
        cambio_fuente: 'misma moneda',
        version: '1',
        lineas: lineOrd,
        editable: true,
      },
    },
    [DEMO.ordB]: {
      data: {
        id: DEMO.ordB,
        proveedor_id: DEMO.proveedorBeta,
        proveedor: 'Proveedor ficticio Beta',
        origen_id: DEMO.solB,
        fecha: '2026-11-06',
        numero: 'OC-DEMO-1002',
        serie: 'OC',
        moneda: 'VES',
        total: '350.00',
        moneda_base: 'VES',
        total_base: '350.00',
        tipo_cambio: '1',
        cambio_fecha: '2026-11-06',
        cambio_fuente: 'misma moneda',
        version: '1',
        lineas: lineSolB,
        editable: true,
      },
    },
    [DEMO.facA]: {
      data: {
        id: DEMO.facA,
        proveedor_id: DEMO.proveedor,
        proveedor: 'Proveedor ficticio Alpha',
        origen_id: DEMO.ordA,
        fecha: '2026-11-03',
        numero: 'FAC-DEMO-1001',
        serie: 'F',
        moneda: 'VES',
        total: '100.00',
        moneda_base: 'VES',
        total_base: '100.00',
        tipo_cambio: '1',
        cambio_fecha: '2026-11-03',
        cambio_fuente: 'misma moneda',
        version: '1',
        lineas: lineOrd,
        editable: !facturaNoEditable,
      },
    },
  };
}

/** Listados del catálogo demo (no sustituye respuestas vacías de otros escenarios). */
export function demoList(collection, scenario, after) {
  if (scenario === 'list-empty-first') {
    return {data: {items: [], next_cursor: ''}};
  }
  if (scenario === 'list-empty-after-page') {
    if (!after) {
      return {
        data: {
          items: [row({id: DEMO.solA, fecha: '2026-11-01', numero: 'SOL-DEMO-1001', proveedor: 'Proveedor ficticio Alpha', total: '100.00'})],
          next_cursor: 'demo-page-2',
        },
      };
    }
    if (after === 'demo-page-2') {
      return {data: {items: [], next_cursor: ''}};
    }
  }

  if (collection === 'solicitudes') {
    if (after === 'demo-page-2') {
      return {
        data: {
          items: [row({id: DEMO.solLibre, fecha: '2026-11-07', numero: 'SOL-DEMO-2000', proveedor: 'Proveedor ficticio Alpha', total: '80.00'})],
          next_cursor: '',
        },
      };
    }
    return {
      data: {
        items: [
          row({id: DEMO.solA, fecha: '2026-11-01', numero: 'SOL-DEMO-1001', proveedor: 'Proveedor ficticio Alpha', total: '100.00'}),
          row({id: DEMO.solB, fecha: '2026-11-05', numero: 'SOL-DEMO-1002', proveedor: 'Proveedor ficticio Beta', total: '350.00'}),
        ],
        next_cursor: 'demo-page-2',
      },
    };
  }

  if (collection === 'ordenes') {
    return {
      data: {
        items: [
          row({id: DEMO.ordA, fecha: '2026-11-02', numero: 'OC-DEMO-1001', proveedor: 'Proveedor ficticio Alpha', total: '100.00'}),
          row({id: DEMO.ordB, fecha: '2026-11-06', numero: 'OC-DEMO-1002', proveedor: 'Proveedor ficticio Beta', total: '350.00'}),
        ],
        next_cursor: '',
      },
    };
  }

  if (collection === 'facturas') {
    return {
      data: {
        items: [row({id: DEMO.facA, fecha: '2026-11-03', numero: 'FAC-DEMO-1001', proveedor: 'Proveedor ficticio Alpha', total: '100.00'})],
        next_cursor: '',
      },
    };
  }

  return {data: {items: [], next_cursor: ''}};
}

export function demoOrigins(collection) {
  if (collection === 'solicitudes') {
    return {
      data: {
        items: [
          row({id: DEMO.solLibre, fecha: '2026-11-07', numero: 'SOL-DEMO-2000', proveedor: 'Proveedor ficticio Alpha', total: '80.00'}),
        ],
        next_cursor: '',
      },
    };
  }
  if (collection === 'ordenes') {
    return {
      data: {
        items: [
          row({id: DEMO.ordB, fecha: '2026-11-06', numero: 'OC-DEMO-1002', proveedor: 'Proveedor ficticio Beta', total: '350.00'}),
        ],
        next_cursor: '',
      },
    };
  }
  return {data: {items: [], next_cursor: ''}};
}

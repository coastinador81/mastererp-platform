import { http } from 'msw';
import { HttpResponse, fail, latency, mock } from '@/shared/mocks/utils';
import { DEMO_RECORDS, demoConnection, demoStatus } from './demo';

/**
 * Simulación MSW del servidor de Uonify para ERP · Finanzas (contrato de mastererp_oauth.py
 * y erp_routes.py), solo en la vista local:
 * GET    /connections/erp             → { connection, available, accessAllowed } (sin tokens ni ids internos)
 * POST   /connections/erp/selection   → { tenantId, companyId? } → { connection }
 * DELETE /connections/erp             → desconecta
 * GET    /erp/:kind?after&limit&q     → { items: [{ ref, … }], nextCursor } (q solo en ventas)
 * GET    /erp/:kind/:ref              → { record }
 * La ventana de MasterERP no se simula: «Conectar» de la vista local llama a connectDemo().
 */
const LIST_OMIT = new Set(['lineas', 'contactos', 'condiciones']);

const listItem = (item: object) => Object.fromEntries(Object.entries(item).filter(([key]) => !LIST_OMIT.has(key)));

const matches = (item: object, q: string) => JSON.stringify(item).toLowerCase().includes(q);

export const handlers = [
  http.get(mock('/connections/erp'), async () => {
    await latency(250);
    return HttpResponse.json({ connection: demoStatus(), available: true, accessAllowed: true });
  }),
  http.post(mock('/connections/erp/selection'), async ({ request }) => {
    await latency(200);
    if (!demoConnection.get().connected) return fail(409, 'Conecta tu cuenta del ERP.', 'erp_reconnect');
    const body = (await request.json().catch(() => ({}))) as { tenantId?: unknown; companyId?: unknown };
    demoConnection.update(state => ({
      ...state,
      tenantId: typeof body.tenantId === 'string' ? body.tenantId : state.tenantId,
      companyId: typeof body.companyId === 'string' ? body.companyId : null,
    }));
    return HttpResponse.json({ connection: demoStatus() });
  }),
  http.delete(mock('/connections/erp'), async () => {
    await latency(200);
    demoConnection.set({ connected: false, tenantId: null, companyId: null });
    return HttpResponse.json({ connection: { status: 'disconnected' } });
  }),
  http.get(mock('/erp/:kind'), async ({ params, request }) => {
    await latency();
    if (!demoConnection.get().connected) return fail(401, 'Conecta tu cuenta del ERP.', 'erp_reconnect');
    const rows = DEMO_RECORDS[String(params.kind)];
    if (!rows) return fail(404, 'Tipo de documento desconocido.', 'erp_not_found');
    const url = new URL(request.url);
    const q = String(params.kind) === 'ventas' ? (url.searchParams.get('q') ?? '').trim().toLowerCase() : '';
    const limit = Math.min(25, Math.max(1, Number(url.searchParams.get('limit')) || 10));
    const visible = rows.filter(row => !q || matches(row, q));
    const after = url.searchParams.get('after');
    const start = after ? visible.findIndex(row => row.ref === after) + 1 : 0;
    const page = visible.slice(start, start + limit);
    return HttpResponse.json({ items: page.map(listItem), nextCursor: start + limit < visible.length ? page.at(-1)?.ref ?? null : null });
  }),
  http.get(mock('/erp/:kind/:ref'), async ({ params }) => {
    await latency(300);
    if (!demoConnection.get().connected) return fail(401, 'Conecta tu cuenta del ERP.', 'erp_reconnect');
    const record = DEMO_RECORDS[String(params.kind)]?.find(row => row.ref === params.ref);
    return record ? HttpResponse.json({ record }) : fail(404, 'No está disponible en esta empresa.', 'erp_not_found');
  }),
];

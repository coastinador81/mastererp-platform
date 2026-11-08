import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getResponse } from 'msw';
import { apiUrl } from '@/shared/api/config';
import { auditRuns, handlers } from '../mocks/handlers';
import { buildAuditResult } from '../mocks/fixtures/auditFixtures';
import { buildScrapedProduct } from '../mocks/fixtures/scrapeFixtures';
import { detectProfile, isAnalyzableInput, pageInfo } from '../mocks/fixtures/detect';
import { amazonModel } from '../model/amazon';
import { DEFAULT_AUDIT, schemaFor } from '../model/schemas';
import { mapScrapedProduct } from '../model/scrape';
import { validateFields } from '../model/validation';

/** POST a una ruta simulada, avanzando la latencia con temporizadores falsos. */
async function post(path: string, body: unknown) {
  const request = new Request(new URL(apiUrl(path), location.origin), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const pending = getResponse(handlers, request);
  let settled = false;
  void pending.finally(() => { settled = true; });
  for (let step = 0; step < 200 && !settled; step += 1) await vi.advanceTimersByTimeAsync(100);
  const response = await pending;
  if (!response) throw new Error(`Sin simulación para ${path}`);
  return { status: response.status, data: await response.json() };
}

beforeEach(() => {
  vi.useFakeTimers();
  auditRuns.reset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('simulación del backend de la Auditoría IA', () => {
  // pim-core.test.cjs comprobaba que POST /ai-audit fallaba con «todavía no está
  // conectado»; ahora la simulación responde con una auditoría realista.
  it('POST /ai-audit devuelve una auditoría en lugar de «no conectado»', async () => {
    const { status, data } = await post('/ai-audit', { url: 'https://tienda.com/frigorifico-combi-no-frost' });
    expect(status).toBe(200);
    expect(JSON.stringify(data)).not.toMatch(/todavía no está conectado/);
    expect(data.detected_category).toBe('REFRIGERATOR');
    expect(data.ai_audit.missing_required_attributes).toEqual(['energy_efficiency_class']);
    expect(data.ai_audit.audit_scores).toEqual({ amazon_readiness: 81, overall_score: 84 });
  });

  it('POST /product-scraper acepta { url } | { asin } | { ean } y guarda el resultado', async () => {
    const byUrl = await post('/product-scraper', { url: 'https://uonify.com/make-it-possible', product_id: 'UON-KIT-01' });
    expect(byUrl.data).toMatchObject({ title: expect.stringMatching(/^Make It Possible by Uonify/), brand: 'Uonify', sku: 'UON-KIT-01' });
    expect(auditRuns.all()).toHaveLength(1);
    expect(auditRuns.all()[0].productId).toBe('UON-KIT-01');
    const byAsin = await post('/product-scraper', { asin: 'B08XYZ1234' });
    const again = await post('/product-scraper', { asin: 'b08xyz1234' });
    expect(again.data).toEqual(byAsin.data);
    expect((await post('/product-scraper', { ean: '8437014523651' })).data.title).toBeTruthy();
  });

  it('errores con el formato del backend: falta la entrada o no se reconoce', async () => {
    expect(await post('/ai-audit', {})).toMatchObject({ status: 400, data: { error: 'bad_request' } });
    const invalid = await post('/product-scraper', { url: 'hola' });
    expect(invalid.status).toBe(422);
    expect(invalid.data.message).toBe('No se reconoce «hola» como URL, ASIN ni EAN.');
  });
});

describe('perfiles simulados', () => {
  it('detecta el perfil por palabras, por código o genérico', () => {
    expect(detectProfile('https://tienda.es/Frigorífico-Combi')).toBe('frigorifico');
    expect(detectProfile('https://tienda.es/smart-tv-55')).toBe('televisor');
    expect(detectProfile('https://uonify.com/productos')).toBe('make-it-possible');
    expect(detectProfile('https://tienda.es/silla-de-oficina')).toBe('generic');
    expect(detectProfile('B08XYZ1234')).toBe(detectProfile('b08xyz1234'));
    expect(isAnalyzableInput('tienda.com/p/silla')).toBe(true);
    expect(isAnalyzableInput('hola')).toBe(false);
  });

  it('producto genérico a partir de la URL', () => {
    expect(pageInfo('https://www.mueblesdelsur.es/p/silla-de-oficina-ergonomica.html')).toEqual({
      host: 'mueblesdelsur.es', brand: 'Mueblesdelsur', title: 'Silla de oficina ergonomica',
    });
    expect(pageInfo('https://tienda.com/').title).toBe('Producto de tienda.com');
  });

  it('los datos simulados recorren el flujo: categoría con esquema, faltantes y atributos', () => {
    const scraped = buildScrapedProduct('https://tienda.es/frigorifico-kelvia');
    const fields = mapScrapedProduct(scraped);
    const schema = schemaFor(scraped.suggested_category ?? 'General');
    expect(validateFields(schema, fields).missingFields).toEqual(['eficiencia_energetica']);
    const result = buildAuditResult('https://tienda.es/frigorifico-kelvia');
    const model = amazonModel({ ...DEFAULT_AUDIT, auditResult: result, amazonAttributes: result.ai_audit?.amazon_attributes as Record<string, unknown> });
    expect(model.missingRows.map(row => row.label)).toEqual(['Clase energética']);
    expect(model.missingOptional.length).toBeGreaterThan(10);
    // La URL genérica deja «precio» como requerido faltante.
    const generic = mapScrapedProduct(buildScrapedProduct('https://mueblesdelsur.es/p/silla'));
    expect(validateFields(schemaFor('General'), generic).missingFields).toEqual(['precio']);
  });
});

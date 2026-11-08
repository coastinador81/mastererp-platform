import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api/client';

const post = vi.hoisted(() => vi.fn());
vi.mock('@/shared/api/client', async importOriginal => {
  const original = await importOriginal<typeof import('@/shared/api/client')>();
  return { ...original, api: { ...original.api, post } };
});

import { AUDIT_ENDPOINTS, AuditTimeoutError, auditProduct, scrapeErrorMessage, scrapeProduct } from '../api/auditApi';

beforeEach(() => {
  post.mockReset();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('aiAuditService.auditProduct', () => {
  it('envía { url } a /ai-audit y devuelve el cuerpo', async () => {
    post.mockResolvedValueOnce({ detected_category: 'TELEVISION' });
    await expect(auditProduct('https://tienda.com/tv')).resolves.toEqual({ detected_category: 'TELEVISION' });
    expect(post).toHaveBeenCalledWith('/ai-audit', { url: 'https://tienda.com/tv' }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('un 2xx sin cuerpo se trata como resultado vacío (A04)', async () => {
    post.mockResolvedValueOnce(null);
    await expect(auditProduct('x.com')).resolves.toEqual({});
  });

  it('reintenta una vez a los 2 s si el servidor falla (5xx)', async () => {
    post.mockRejectedValueOnce(new ApiError(503, null)).mockResolvedValueOnce({ ok: true });
    const pending = auditProduct('x.com');
    await vi.advanceTimersByTimeAsync(2000);
    await expect(pending).resolves.toEqual({ ok: true });
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('no reintenta un error del cliente (4xx) y se rinde tras dos fallos', async () => {
    post.mockRejectedValueOnce(new ApiError(422, { message: 'No se ha podido auditar' }));
    await expect(auditProduct('hola')).rejects.toMatchObject({ status: 422 });
    expect(post).toHaveBeenCalledTimes(1);
    post.mockReset();
    post.mockRejectedValue(new ApiError(500, null));
    const pending = auditProduct('x.com').catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await pending).toBeInstanceOf(ApiError);
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('agota el tiempo a los 90 s y reintenta', async () => {
    post.mockImplementation((_path: string, _body: unknown, options: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    const pending = auditProduct('x.com').catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(90_000 + 2000 + 90_000);
    const error = await pending;
    expect(error).toBeInstanceOf(AuditTimeoutError);
    expect((error as Error).message).toMatch(/90 s/);
    expect(post).toHaveBeenCalledTimes(2);
  });
});

describe('productScraperService.scrapeProduct', () => {
  it('envía la entrada según su tipo y el id del producto', async () => {
    post.mockResolvedValue({ title: 'x' });
    await scrapeProduct('8437014523651', 'UON-KIT-01');
    expect(post).toHaveBeenLastCalledWith(AUDIT_ENDPOINTS.PRODUCT_SCRAPER, { ean: '8437014523651', product_id: 'UON-KIT-01' });
  });

  it('mensaje de error: frase del backend, su message o uno por defecto', () => {
    expect(scrapeErrorMessage(new ApiError(422, { error: 'Página no encontrada en la tienda' }))).toBe('Página no encontrada en la tienda');
    expect(scrapeErrorMessage(new ApiError(422, { error: 'invalid_input', message: 'No se reconoce' }))).toBe('No se reconoce');
    expect(scrapeErrorMessage(new ApiError(500, null))).toBe('Error al procesar la URL');
    expect(scrapeErrorMessage(new Error('Sin título'))).toBe('Sin título');
  });
});

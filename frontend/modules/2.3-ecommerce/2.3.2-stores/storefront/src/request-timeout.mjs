export const STOREFRONT_REQUEST_TIMEOUT_MS = 12_000;

export async function fetchWithTimeout(fetcher, url, options = {}, timeoutMs = STOREFRONT_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetcher(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw new Error('La conexión está tardando demasiado. Intenta nuevamente.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

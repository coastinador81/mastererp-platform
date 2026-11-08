import { clamp, debounce, download, escapeHTML, formatBytes, readFileAsDataURL, readFileAsText, uid } from '@/shared/lib';

describe('utilidades del núcleo (pim/core.js util)', () => {
  test('formatBytes como el prototipo', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(351930)).toBe('343.7 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatBytes(Number.NaN)).toBe('');
  });

  test('escapeHTML escapa los cinco caracteres', () => {
    expect(escapeHTML(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
    expect(escapeHTML(null)).toBe('');
  });

  test('uid lleva el prefijo y no se repite', () => {
    const a = uid('toast');
    const b = uid('toast');
    expect(a).toMatch(/^toast-[a-z0-9]+-[a-z0-9]+$/);
    expect(a).not.toBe(b);
  });

  test('clamp', () => {
    expect(clamp(150, 0, 100)).toBe(100);
    expect(clamp(-5, 0, 100)).toBe(0);
    expect(clamp(42, 0, 100)).toBe(42);
  });

  test('debounce: una llamada con los últimos argumentos; cancel y flush', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const run = debounce(fn, 200);
    run(1);
    run(2);
    vi.advanceTimersByTime(199);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledExactlyOnceWith(2);
    run(3);
    run.cancel();
    vi.advanceTimersByTime(500);
    expect(fn).toHaveBeenCalledTimes(1);
    run(4);
    run.flush();
    expect(fn).toHaveBeenLastCalledWith(4);
    vi.useRealTimers();
  });

  test('lee archivos como texto y como data URL', async () => {
    const file = new File(['hola'], 'nota.txt', { type: 'text/plain' });
    await expect(readFileAsText(file)).resolves.toBe('hola');
    await expect(readFileAsDataURL(file)).resolves.toMatch(/^data:text\/plain;base64,/);
  });

  test('download crea un enlace temporal y lo pulsa', () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    download('data:text/plain,hola', 'nota.txt');
    expect(click).toHaveBeenCalledOnce();
    expect(document.querySelector('a[download]')).toBeNull();
    click.mockRestore();
  });
});

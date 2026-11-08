import { act, renderHook } from '@testing-library/react';
import { useDebouncedValue, useInterval, useReducedMotion } from '@/shared/hooks';

describe('hooks compartidos', () => {
  afterEach(() => {
    vi.useRealTimers();
    delete document.documentElement.dataset.reduceMotion;
  });

  test('useInterval llama cada intervalo y para con null', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const { rerender } = renderHook(({ delay }) => useInterval(fn, delay), { initialProps: { delay: 100 as number | null } });
    act(() => { vi.advanceTimersByTime(350); });
    expect(fn).toHaveBeenCalledTimes(3);
    rerender({ delay: null });
    act(() => { vi.advanceTimersByTime(500); });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  test('useDebouncedValue entrega el valor cuando deja de cambiar', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 200), { initialProps: { value: 'a' } });
    rerender({ value: 'ab' });
    expect(result.current).toBe('a');
    act(() => { vi.advanceTimersByTime(200); });
    expect(result.current).toBe('ab');
  });

  test('useReducedMotion respeta la preferencia de la cuenta (:root[data-reduce-motion])', async () => {
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
    await act(async () => {
      document.documentElement.dataset.reduceMotion = 'true';
      await Promise.resolve();
    });
    expect(result.current).toBe(true);
  });
});

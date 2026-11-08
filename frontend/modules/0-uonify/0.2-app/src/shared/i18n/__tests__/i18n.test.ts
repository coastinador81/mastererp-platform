import { AVAILABLE_LOCALES, DEFAULT_LOCALE, isAvailable, isLocale, getLocale, setLocale, t } from '@/shared/i18n';

describe('andamiaje i18n', () => {
  test('el español de España es el idioma por defecto y el único disponible hoy', () => {
    expect(DEFAULT_LOCALE).toBe('es-ES');
    expect([...AVAILABLE_LOCALES]).toEqual(['es-ES']);
    expect(isAvailable('es-ES')).toBe(true);
    expect(isAvailable('en')).toBe(false);
    expect(isLocale('es-ES')).toBe(true);
    expect(isLocale('fr')).toBe(false);
  });

  test('t resuelve claves con puntos, interpola y cae a la clave si falta', () => {
    expect(t('common.save')).toBe('Guardar cambios');
    expect(t('language.current', { name: 'Español' })).toBe('Idioma actual: Español');
    expect(t('no.existe')).toBe('no.existe');
  });

  test('no se puede fijar un idioma que aún no está disponible', () => {
    expect(getLocale()).toBe('es-ES');
    expect(setLocale('en')).toBe('es-ES');
    expect(getLocale()).toBe('es-ES');
  });
});

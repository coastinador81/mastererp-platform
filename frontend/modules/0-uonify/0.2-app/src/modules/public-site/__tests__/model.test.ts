import {
  clampEffort, COMPOSER_EFFORTS, effortsFor, findEffort, MAX_ATTACHMENT_BYTES, normalizePreferences, speedLabel, splitAttachments,
} from '../model/composerOptions';
import { KIT_DEFAULT_DURATION, kitCameraAt, poseTime, smoothstep } from '../model/kitCamera';
import { hrefKind, LEGACY_FILES, toAppHref } from '../model/links';
import { horizontalShift, moreMenuPosition, pickerPlacement } from '../model/placement';
import { applyHomePreferences, HOME_PREFERENCES_KEY, readHomePreferences } from '../model/storage';
import { nextTabIndex } from '../model/tabs';
import { isPublicViewKey, PATHS, PUBLIC_PATHS, PUBLIC_VIEWS } from '../model/views';

describe('vistas públicas (tabla de unified.js)', () => {
  test('cada vista tiene su ruta, título y clase del body del PROTO', () => {
    expect(PUBLIC_VIEWS.portada).toMatchObject({ path: '/', title: 'Uonify — Hazlo posible' });
    expect(PUBLIC_VIEWS.producto).toMatchObject({ path: '/productos', title: 'Servicios — Uonify' });
    expect(PUBLIC_VIEWS['como-funciona'].bodyClass).toBe('how-page');
    expect(PUBLIC_VIEWS['para-empresas'].bodyClass).toBe('enterprise-page');
    expect(PUBLIC_VIEWS.empresa).toMatchObject({ path: '/sobre-uonify', bodyClass: 'about-page' });
    expect(PUBLIC_VIEWS.novedades.bodyClass).toBe('news-page');
    expect(PUBLIC_VIEWS.privacidad).toMatchObject({ path: '/privacidad', title: 'Privacidad — Uonify' });
    expect(PUBLIC_VIEWS.terminos).toMatchObject({ path: '/terminos', title: 'Condiciones — Uonify' });
    // Todas llevan una meta descripción propia (buscadores y buscadores de IA).
    Object.values(PUBLIC_VIEWS).forEach(view => expect(view.description.length).toBeGreaterThan(80));
  });

  test('Privacidad y Condiciones son rutas públicas', () => {
    expect(PUBLIC_PATHS).toEqual(expect.arrayContaining(['/privacidad', '/terminos', '/']));
    expect(PATHS.composer).toBe('/#composer');
    expect(isPublicViewKey('empresa')).toBe(true);
    expect(isPublicViewKey('espacio')).toBe(false);
    expect(isPublicViewKey('toString')).toBe(false);
  });
});

describe('reescritura de enlaces del PROTO', () => {
  test('páginas .html y vistas de index.html pasan a rutas, con su ancla', () => {
    expect(toAppHref('producto.html#catalogo')).toBe('/productos#catalogo');
    expect(toAppHref('empresa.html')).toBe('/sobre-uonify');
    expect(toAppHref('para-empresas.html?v=20260922-empresas')).toBe('/para-empresas');
    expect(toAppHref('privacidad.html')).toBe('/privacidad');
    expect(toAppHref('index.html?view=terminos')).toBe('/terminos');
    expect(toAppHref('index.html#composer')).toBe('/#composer');
  });

  test('el espacio conserva solo el servicio y una vista desconocida resuelve a la portada', () => {
    expect(toAppHref('index.html?view=espacio&service=erp')).toBe('/espacio?service=erp');
    expect(toAppHref('index.html?view=espacio')).toBe('/espacio');
    expect(toAppHref('index.html?view=inventada')).toBe('/');
    expect(toAppHref('index.html?auth=return')).toBe('/?auth=return');
  });

  test('anclas, externos y archivos desconocidos no cambian', () => {
    expect(toAppHref('#contenido')).toBe('#contenido');
    expect(toAppHref('mailto:developers@uonify.com?subject=Hola')).toBe('mailto:developers@uonify.com?subject=Hola');
    expect(toAppHref('https://chatgpt.com/')).toBe('https://chatgpt.com/');
    expect(toAppHref('assets/galeria-v57/01-hero.webp')).toBe('assets/galeria-v57/01-hero.webp');
    expect(LEGACY_FILES).toEqual(expect.arrayContaining(['index.html', 'producto.html', 'empresa.html', 'terminos.html']));
    expect(hrefKind('#x')).toBe('hash');
    expect(hrefKind('/productos')).toBe('route');
    expect(hrefKind('//cdn.example.com/x')).toBe('external');
  });
});

describe('opciones de IA del compositor (composer-tools)', () => {
  test('el esfuerzo es una lista corta de niveles', () => {
    expect(COMPOSER_EFFORTS.map(effort => effort.id)).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    expect(findEffort('max').label).toBe('Ultra');
  });

  test('GPT-5.5 se queda en «Muy alto»: Ultra desaparece y la elección baja', () => {
    expect(effortsFor('gpt-5.5').map(effort => effort.id)).not.toContain('max');
    expect(clampEffort('gpt-5.5', 'max')).toBe('xhigh');
    expect(clampEffort('auto', 'max')).toBe('max');
    expect(normalizePreferences({ model: 'gpt-5.5', effort: 'max', speed: 'fast' })).toEqual({ model: 'gpt-5.5', effort: 'xhigh', speed: 'fast' });
  });

  test('lo guardado desconocido vuelve a los valores por defecto', () => {
    expect(normalizePreferences(null)).toEqual({ model: 'auto', effort: 'medium', speed: 'standard' });
    expect(normalizePreferences({ model: 'gpt-9', effort: 'extremo', speed: 'turbo' })).toEqual({ model: 'auto', effort: 'medium', speed: 'standard' });
    expect(speedLabel('fast')).toBe('Desactivar modo rápido y volver a velocidad normal');
  });

  test('los adjuntos de más de 10 MB se rechazan', () => {
    const small = new File(['a'], 'ficha.pdf');
    const big = new File(['a'], 'video.mov');
    Object.defineProperty(big, 'size', { value: MAX_ATTACHMENT_BYTES + 1 });
    expect(splitAttachments([small, big])).toEqual({ accepted: [small], rejected: [big] });
  });
});

describe('colocación de los menús del compositor', () => {
  test('en la portada se abre hacia abajo si hay sitio', () => {
    expect(pickerPlacement({ pickerTop: 300, pickerBottom: 336, viewportHeight: 900, onLanding: true, desired: 470, contentHeight: 400 }))
      .toEqual({ below: true, maxHeight: 470 });
    expect(pickerPlacement({ pickerTop: 500, pickerBottom: 536, viewportHeight: 700, onLanding: false, desired: 260, contentHeight: 200 }))
      .toEqual({ below: false, maxHeight: 260 });
  });

  test('no se sale del compositor ni de la ventana', () => {
    expect(horizontalShift({ left: 0, right: 300 }, { left: 20, right: 800 }, 1200)).toBe(20);
    expect(horizontalShift({ left: 600, right: 900 }, { left: 20, right: 800 }, 1200)).toBe(-100);
    expect(horizontalShift({ left: 40, right: 300 }, { left: 20, right: 800 }, 1200)).toBe(0);
  });

  test('el menú «+» queda justo encima de su botón', () => {
    const box = { left: 20, bottom: 140, width: 300 };
    expect(moreMenuPosition(box, { left: 60, top: 120 }, 200)).toEqual({ left: 40, bottom: 26 });
    expect(moreMenuPosition(box, { left: 300, top: 120 }, 240)).toEqual({ left: 60, bottom: 26 });
  });
});

describe('pestañas con teclado', () => {
  test('flechas en bucle, Inicio y Fin', () => {
    expect(nextTabIndex('ArrowRight', 2, 3)).toBe(0);
    expect(nextTabIndex('ArrowLeft', 0, 3)).toBe(2);
    expect(nextTabIndex('Home', 2, 3)).toBe(0);
    expect(nextTabIndex('End', 0, 3)).toBe(2);
    expect(nextTabIndex('Enter', 0, 3)).toBeUndefined();
  });
});

describe('cámara del juego de piezas', () => {
  test('encuadre del conjunto al inicio y al final; torre a mitad', () => {
    expect(kitCameraAt(0, 8)).toEqual({ cameraOrbit: '0deg 38deg 15m', cameraTarget: '0m 1.1m 0m', fieldOfView: '45deg' });
    expect(kitCameraAt(8, 8)).toEqual(kitCameraAt(0, 8));
    expect(kitCameraAt(4, 8)).toMatchObject({ cameraOrbit: '25deg 65deg 8m', fieldOfView: '38deg' });
    expect(kitCameraAt(4, 0)).toEqual(kitCameraAt(KIT_DEFAULT_DURATION / 2, KIT_DEFAULT_DURATION));
    expect(poseTime('tower', 8)).toBe(4);
    expect(poseTime('assembled', 8)).toBe(0);
    expect(smoothstep(0.5)).toBe(0.5);
  });
});

describe('preferencias de la portada', () => {
  beforeEach(() => sessionStorage.clear());

  test('se leen de la pestaña y se aplican al documento', () => {
    expect(readHomePreferences()).toEqual({ contrast: false, reduceMotion: false });
    sessionStorage.setItem(HOME_PREFERENCES_KEY, JSON.stringify({ contrast: true, reduceMotion: 'sí' }));
    const prefs = readHomePreferences();
    expect(prefs).toEqual({ contrast: true, reduceMotion: false });
    const root = document.createElement('div');
    applyHomePreferences(prefs, root);
    expect(root.dataset).toMatchObject({ moreContrast: 'true', reduceMotion: 'false' });
  });
});

import { describe, expect, it } from 'vitest';
import { ADS_MAX_BYTES, AMAZON_ADS_CONNECTED, AUDIO_NOTICE, DESTINATIONS, LISTING_MAX_BYTES, PATHS, TERMS_TEXT, TERMS_TITLE, TERMS_VERSION } from '../model/constants';
import { clip, clock, money } from '../model/format';
import { lintShot, lintText, planIssues } from '../model/lint';
import { draftPlan, resolveShot } from '../model/plan';
import { fallbackLine, projectFrom, resultLine } from '../model/project';
import { requirements } from '../model/requirements';
import type { RequirementRow } from '../model/types';
import { acceptTerms, termsKey, termsRecord } from '../lib/terms';
import { SAMPLE_PLANS } from './fixtures';

// Puerto de tests/video-studio.test.cjs y de la parte de Vídeo de sample-product.test.cjs (PROTO).
// Intl separa importe y moneda con un espacio fino de no separación (U+00A0 / U+202F).
const spaces = (text: string) => String(text).replace(/[\u00a0\u202f]/g, ' ');
const failing = (rows: RequirementRow[]) => rows.filter(row => row.required && !row.ok).map(row => row.id);
const plain = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe('textos aprobados por el abogado', () => {
  it('se publican tal cual', () => {
    expect(TERMS_TEXT).toBe('Uonify genera vídeos, imágenes y textos con modelos de inteligencia artificial de terceros, como Google u OpenAI. Su disponibilidad, funcionamiento y precio dependen de esos proveedores y pueden cambiar sin previo aviso. Si el modelo previsto no está disponible, Uonify podrá completar la tarea con otro modelo o plataforma disponible para entregarte el resultado solicitado. En ese caso, el saldo consumido corresponderá al modelo utilizado, que puede ser distinto del previsto.');
    expect(AUDIO_NOTICE).toBe('Con audio, cada vídeo consume más saldo que sin audio. Los modelos de IA son servicios de terceros: si el previsto no está disponible, usaremos otro para completar tu vídeo y se descontará el saldo del modelo utilizado.');
    expect(TERMS_TITLE).toBe('Modelos de IA de terceros.');
    expect(TERMS_VERSION).toBe('2026-09-26');
    expect(spaces(resultLine({ provider: 'gemini-api', model: 'veo-3.1', audio: true, charged: { amount: 4.48, currency: 'EUR' }, fallbackFrom: null }))).toBe('Generado con Veo 3.1 (Gemini API) · con audio · 4,48 € de saldo');
    expect(spaces(resultLine({ provider: 'vertex-ai', model: 'veo-3.1-generate-001', audio: false, charged: { amount: 2.24, currency: 'EUR' }, fallbackFrom: null }))).toBe('Generado con Veo 3.1 (Vertex AI) · sin audio · 2,24 € de saldo');
    expect(fallbackLine({ fallbackFrom: 'vertex-ai' })).toBe('Vertex AI no estaba disponible en ese momento.');
    expect(fallbackLine({ fallbackFrom: null })).toBe('');
  });
});

describe('requisitos de Amazon', () => {
  it('ficha: Seller Central (hasta 1080p, 16:9 o 9:16, hasta 12 min, título, ASIN e idioma)', () => {
    const video = { name: 'a.mp4', type: 'video/mp4', size: 28e6, width: 1920, height: 1080, duration: 30, title: 'Juego', language: 'es', destination: 'listing' as const };
    expect(failing(requirements(video, 'B0TEST1234'))).toEqual([]);
    expect(failing(requirements({ ...video, width: 1080, height: 1920 }, 'B0TEST1234'))).toEqual([]);
    expect(failing(requirements({ ...video, width: 3840, height: 2160 }, 'B0TEST1234'))).toEqual(['resolution']);
    expect(failing(requirements({ ...video, duration: 13 * 60 }, 'B0TEST1234'))).toEqual(['duration']);
    expect(failing(requirements({ ...video, title: ' ' }, ''))).toEqual(['title', 'asin']);
    expect(failing(requirements({ ...video, size: 6 * 1024 ** 3 }, 'B0TEST1234'))).toEqual(['size']);
    const poster = requirements(video, 'B0TEST1234').find(row => row.id === 'poster');
    expect(poster?.required).toBe(false);
  });

  it('anuncio: Sponsored Brands y display (16:9 a 1920 × 1080, de 6 a 45 s, hasta 500 MB)', () => {
    const video = { name: 'a.mp4', type: 'video/mp4', size: 40e6, width: 1920, height: 1080, duration: 15, destination: 'ads' as const };
    expect(failing(requirements(video))).toEqual([]);
    expect(failing(requirements({ ...video, width: 1280, height: 720 }))).toEqual(['resolution']);
    expect(failing(requirements({ ...video, width: 3840, height: 2160 }))).toEqual([]);
    expect(failing(requirements({ ...video, width: 2560, height: 1440 }))).toEqual(['resolution']);
    expect(failing(requirements({ ...video, width: 1080, height: 1920 }))).toEqual(['resolution', 'ratio']);
    expect(failing(requirements({ ...video, duration: 50 }))).toEqual(['duration']);
    expect(failing(requirements({ ...video, size: 600 * 1024 ** 2 }))).toEqual(['size']);
    const display = requirements({ ...video, duration: 20 }).find(row => row.id === 'display');
    expect(display?.ok).toBe(false);
    expect(display?.value).toBe('Solo Sponsored Brands');
    expect(display?.required).toBe(false);
  });

  it('usa los límites de Amazon', () => {
    expect(LISTING_MAX_BYTES).toBe(5 * 1024 ** 3);
    expect(ADS_MAX_BYTES).toBe(500 * 1024 ** 2);
  });
});

describe('revisión de los textos del guion', () => {
  const errors = (text: string) => lintText(text).filter(issue => issue.level === 'error').map(issue => issue.message);

  it('rechaza lo que Amazon no admite', () => {
    for (const text of ['Solo 9,99 €', 'Por 20 euros', 'EUR 34,90', 'PVP 34,90', '-20 % hoy', '20 % de descuento', 'Ahorra un 20 %', 'Envío gratis', 'Envío gratuito', 'Sin gastos de envío', 'Black Friday', '2x1', 'Liquidación', 'Últimas unidades', 'Cómpralo ya', 'Cómprala', 'Añádela al carrito', 'Llévatelo hoy', 'Visítanos', 'Síguenos en Instagram', 'Solo por hoy', 'Visita uonify.com', 'www.uonify.es', 'uonify.eu', 'Llama al 612 34 56 78', '+34 91 123 45 67', '★★★★★', '4,8/5', '5 estrellas', 'Más de 500 reseñas', 'El favorito de Amazon', 'Envío Prime', 'Top ventas', 'Superventas', 'Número 1 en ventas']) {
      expect(errors(text).length, text).toBeGreaterThan(0);
    }
  });

  it('deja pasar el castellano normal', () => {
    for (const text of ['25 piezas. Tres personajes.', 'Apila por turnos, en equilibrio.', 'Madera en primer plano', 'Precisión en cada pieza', 'Pie de roble macizo', 'Cuando cae, empieza otra idea.', '100 % algodón', 'Algodón 100 %', 'Ahorra espacio', 'Rebaja el estrés', 'Batería de 10.000 mAh', 'Mide 20x30 cm', 'Tres estrellas de madera', 'La visita al taller', 'Aprovecha cada rincón', 'Consigue un acabado perfecto', 'Ref. 600 700 800', '']) {
      expect(errors(text), text).toEqual([]);
    }
    expect(lintText('EL MEJOR JUEGO')[0].level).toBe('warn');
  });

  it('Veo no genera niños en la UE', () => {
    const shot = { image: { url: 'https://x/a.jpg' }, action: 'Dos niños juegan con la torre', text: '' };
    expect(lintShot(shot).some(issue => /no genera niños/.test(issue.message))).toBe(true);
    for (const action of ['Un padre y su hijo apilan piezas', 'Los peques juegan', 'Un bebé juega']) {
      expect(lintShot({ ...shot, action }).some(issue => issue.level === 'error'), action).toBe(true);
    }
    for (const action of ['Una mujer bebe café', 'Detalles menores del acabado']) expect(lintShot({ ...shot, action }), action).toEqual([]);
    expect(lintShot({ ...shot, action: 'Una familia juega en el salón' })[0].level).toBe('warn');
    expect(lintShot({ ...shot, action: 'Dos adultos juegan con la torre' })).toEqual([]);
    expect(lintShot({ image: null, action: ' ', text: '' }).map(issue => issue.field)).toEqual(['image', 'action']);
  });
});

describe('guion', () => {
  it('el borrador sale de la ficha: una foto por plano, textos de las viñetas y la marca en el cierre', () => {
    const images = [{ url: 'https://x/main.jpg', source: 'upload' }, { url: 'https://x/pt1.jpg', source: 'upload' }, { url: 'https://x/ia.jpg', source: 'ai-generated' }];
    const product = { name: 'Lámpara', brand: 'Nórdika', bullets: ['Pie de roble macizo: aguanta el paso del tiempo', 'Pantalla de lino natural. Luz cálida'] };
    const listing = draftPlan('listing', product, images);
    expect(listing.shots).toHaveLength(4);
    expect(listing.shots.map(shot => shot.image?.url)).toEqual(['https://x/main.jpg', 'https://x/ia.jpg', 'https://x/pt1.jpg', 'https://x/main.jpg']);
    expect(listing.shots.map(shot => shot.text)).toEqual(['Pie de roble macizo', 'Pantalla de lino natural', '', '']);
    expect(draftPlan('ads', { bullets: ['Batería de 10.000 mAh para todo el día'] }, images).shots[0].text).toBe('Batería de 10.000 mAh para todo el día');
    // Una foto subida en Imágenes es una data: URL: el guion guarda la referencia, no la imagen.
    const uploaded = [{ id: 'img-1', url: `data:image/jpeg;base64,${'A'.repeat(5000)}`, name: 'foto.jpg', width: 800, height: 600, source: 'upload' as const }];
    const stored = JSON.stringify(draftPlan('listing', product, uploaded));
    expect(stored.includes('data:image')).toBe(false);
    expect(stored.length).toBeLessThan(2000);
    const resolved = resolveShot(JSON.parse(stored).shots[0], uploaded);
    expect(resolved.image?.url).toBe(uploaded[0].url);
    expect(listing.closing.tagline).toBe('Nórdika');
    const ads = draftPlan('ads', product, []);
    expect(ads.shots).toHaveLength(2);
    expect(ads.shots[0].image).toBeNull();
    const seconds = (id: 'listing' | 'ads') => DESTINATIONS[id].shots * DESTINATIONS[id].shotSeconds + DESTINATIONS[id].closingSeconds;
    expect(seconds('listing')).toBe(30);
    expect(seconds('ads')).toBe(15);
    expect(clock(6.5)).toBe('0:06,5');
    expect(clock(28)).toBe('0:28');
    expect(clip('Pantalla de lino natural con una luz cálida que acompaña', 42)).toBe('Pantalla de lino natural con una luz');
  });

  it('los guiones del producto de ejemplo pasan la revisión, con fotos reales y solo adultos', () => {
    for (const destination of ['listing', 'ads'] as const) {
      const plan = SAMPLE_PLANS[destination];
      expect(plan.shots).toHaveLength(DESTINATIONS[destination].shots);
      expect(planIssues(plan)).toEqual([]);
      for (const shot of plan.shots) {
        expect(shot.text.length).toBeLessThanOrEqual(42);
        expect(shot.action.length).toBeLessThanOrEqual(400);
        expect(`${shot.action} ${shot.text}`).not.toMatch(/jenga/i);
      }
    }
  });
});

describe('vídeo en curso', () => {
  it('conserva los estados conocidos y convierte el resultado en la línea aprobada', () => {
    const project = plain(projectFrom({ id: 7, status: 'weird', shots: [{ id: 'shot-1', status: 'blocked', error: 'Filtro' }, { id: 'shot-2', status: '???' }] }, { destination: 'ads', format: '16:9', audio: false }));
    expect(project?.id).toBe('7');
    expect(project?.status).toBe('queued');
    expect(project?.shots.map(shot => shot.status)).toEqual(['blocked', 'queued']);
    expect(project?.destination).toBe('ads');
    const done = projectFrom({ id: 'p1', status: 'done', result: { url: 'https://cdn/v.mp4', provider: 'gemini-api', model: 'veo-3.1', audio: false, charged: { amount: '4.48', currency: 'EUR' }, fallback_from: 'vertex-ai' } }, { destination: 'listing' });
    expect(done?.result?.generation.fallbackFrom).toBe('vertex-ai');
    expect(spaces(resultLine(done?.result?.generation))).toBe('Generado con Veo 3.1 (Gemini API) · sin audio · 4,48 € de saldo');
    expect(projectFrom({ status: 'done' }, {})).toBeNull();
    const withProjectAudio = projectFrom({ id: 'p2', status: 'done', audio: true, result: { url: 'https://cdn/v.mp4', provider: 'vertex-ai' } }, { destination: 'listing' });
    expect(withProjectAudio?.result?.generation.audio).toBe(true);
    expect(projectFrom({ id: 'p3', status: 'done', result: { url: 'javascript:alert(1)' } }, { destination: 'listing' })?.result).toBeNull();
    expect(projectFrom({ id: 'p4', status: 'done', result: { url: '/assets/video.mp4' } }, { destination: 'listing' })?.result?.url).toBe('/assets/video.mp4');
    expect(spaces(money({ amount: 4.48, currency: 'usd' }))).toBe('4,48 US$');
    expect(fallbackLine({ fallbackFrom: 'otra' })).toBe('El modelo previsto no estaba disponible en ese momento.');
  });
});

describe('servidor y secretos', () => {
  const sources = import.meta.glob<string>(['../**/*.{ts,tsx}', '!../__tests__/**'], { query: '?raw', import: 'default', eager: true });
  const all = Object.values(sources).join('\n');

  it('solo habla con el servidor de Uonify (rutas del prototipo)', () => {
    expect(PATHS).toMatchObject({ balance: '/billing/balance', plans: '/video/plans', projects: '/video/projects', adsAssets: '/amazon/ads/assets', uploads: '/uploads' });
    expect(all).not.toMatch(/generativelanguage\.googleapis|aiplatform\.googleapis|api\.openai\.com|x-goog-api-key|apiKey/i);
    expect(all).not.toMatch(/\/amazon\/videos/);
    expect(all).toMatch(/\/creatorhub\/video\/library\//);
    expect(all).toMatch(/terms_accepted_at: terms\.acceptedAt/);
    expect(all).not.toMatch(/new FormData\(\)/);
    expect(Object.keys(sources).length).toBeGreaterThan(20);
  });

  it('cada cuenta acepta las condiciones una vez, con versión y fecha', () => {
    expect(termsKey('ana@uonify.com')).toBe('ana@uonify.com:uonify-ai-terms');
    expect(termsKey(null)).toBe('uonify-ai-terms');
    const map = new Map<string, string>();
    const storage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
    expect(termsRecord(storage, 'ana@uonify.com')).toBeNull();
    const record = acceptTerms(storage, 'ana@uonify.com', new Date('2026-09-26T10:00:00Z'));
    expect(record).toEqual({ version: '2026-09-26', acceptedAt: '2026-09-26T10:00:00.000Z' });
    expect(termsRecord(storage, 'ana@uonify.com')).toEqual(record);
    expect(termsRecord(storage, 'otra@uonify.com')).toBeNull();
    map.set('ana@uonify.com:uonify-ai-terms', JSON.stringify({ version: '2025-01-01', acceptedAt: 'x' }));
    expect(termsRecord(storage, 'ana@uonify.com')).toBeNull();
  });

  it('el anuncio se descarga hasta que exista la conexión con Amazon Ads (decisión del dueño)', () => {
    expect(AMAZON_ADS_CONNECTED).toBe(false);
  });
});

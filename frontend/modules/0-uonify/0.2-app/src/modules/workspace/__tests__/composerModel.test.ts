import { clampEffort, EFFORTS, effortLabel, findModel, maxEffortIndex, normalizePreferences } from '../model/composerOptions';
import { moreMenuPosition, servicesMenuRight, usagePanelPosition } from '../model/placement';
import { summarizeUsage, usageRows } from '../model/usage';
import { consume, initialUsage, toUsageData } from '../mocks/usageModel';

// Puerto de tests/composer-tools del prototipo (lógica del compositor).

describe('modelo y esfuerzo', () => {
  it('el esfuerzo es una lista corta de niveles, con Ultra al final', () => {
    expect(EFFORTS.map(effort => effort.id)).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    expect(effortLabel('max')).toBe('Ultra');
  });

  it('GPT-5.5 se queda en «Muy alto»: Ultra desaparece y la elección baja', () => {
    expect(maxEffortIndex('gpt-5.5')).toBe(3);
    expect(clampEffort('gpt-5.5', 'max')).toBe('xhigh');
    expect(clampEffort('gpt-6-astra', 'max')).toBe('max');
    expect(normalizePreferences({ model: 'gpt-5.5', effort: 'max', speed: 'fast' })).toEqual({ model: 'gpt-5.5', effort: 'xhigh', speed: 'fast' });
  });

  it('preferencias desconocidas vuelven a Auto · Medio · normal; se conservan los nombres completos', () => {
    expect(normalizePreferences({ model: 'otro', effort: 'x', speed: 'turbo' })).toEqual({ model: 'auto', effort: 'medium', speed: 'standard' });
    expect(normalizePreferences(null)).toEqual({ model: 'auto', effort: 'medium', speed: 'standard' });
    expect(findModel('gpt-5.6-terra')).toMatchObject({ label: 'GPT-5.6 Terra', short: '5.6 Terra' });
  });
});

describe('límites de uso', () => {
  it('los datos de la API llegan al indicador en porcentaje usado', () => {
    const summary = summarizeUsage({ remainingTokens: 500, tokenLimit: 1000, remainingRequests: 9, requestLimit: 10 });
    expect(summary.label).toBe('50%');
    expect(summary.rows.map(row => row.label)).toEqual(['Tokens', 'Solicitudes']);
    expect(summary.rows[0].detail).toBe('500 de 1000 disponibles');
    expect(summarizeUsage({ remainingTokens: 300, tokenLimit: 1000 }).ariaLabel).toMatch(/70 % usado/);
  });

  it('se leen como los límites del plan de Claude: etiqueta, reinicio y porcentaje', () => {
    const summary = summarizeUsage({ plan: 'Plus', limits: [{ label: 'Límite de 5 horas', usedPercent: 6, reset: '2 h 46 min' }, { label: 'Semanal · todos los modelos', usedPercent: 26, resetText: 'el mié, 3:00' }] });
    expect(summary.heading).toBe('Límites de uso del plan · Plus');
    expect(summary.rows[0]).toMatchObject({ label: 'Límite de 5 horas', used: 6, reset: 'en 2 h 46 min' });
    expect(summary.rows[1].reset).toBe('el mié, 3:00');
    expect(summary.label).toBe('26%'); // el límite más gastado
    expect(summary.tooltip).toBe('Límites de uso · 26 % usado');
  });

  it('sin datos no inventa nada', () => {
    const summary = summarizeUsage(null);
    expect(summary).toMatchObject({ main: null, label: 'Uso', heading: 'Límites de uso · OpenAI', ariaLabel: 'Límites de uso de OpenAI' });
    expect(usageRows({ limits: [{ label: '', usedPercent: 10 }] })).toEqual([]);
  });

  it('la simulación del backend gasta según esfuerzo y velocidad', () => {
    const start = initialUsage(Date.UTC(2026, 8, 26, 10));
    const next = consume(start, 'max', 'fast', Date.UTC(2026, 8, 26, 10));
    expect(next.fiveHourUsed).toBe(12);
    expect(next.requests).toBe(1);
    const data = toUsageData(next, Date.UTC(2026, 8, 26, 10));
    expect(data.limits?.[0]).toMatchObject({ label: 'Límite de 5 horas', usedPercent: 12, reset: '2 h 46 min' });
    expect(data.limits?.[1].resetText).toMatch(/^el mié, 3:00$/);
  });
});

describe('colocación de los menús', () => {
  const form = { top: 100, bottom: 140, left: 20, right: 320, width: 300 };

  it('el panel de uso queda encima de su botón, no del compositor', () => {
    const button = { top: 120, bottom: 140, left: 60, right: 100, width: 40 };
    expect(usagePanelPosition(form, button, 200)).toEqual({ left: 36, bottom: 26 });
  });

  it('el menú «+» se alinea a su botón sin salirse del compositor', () => {
    const button = { top: 110, bottom: 140, left: 300, right: 320, width: 20 };
    expect(moreMenuPosition(form, button, 240)).toEqual({ left: 60, bottom: 36 });
  });

  it('el menú de servicios cuelga del lanzador sin salirse por la izquierda', () => {
    expect(servicesMenuRight(1200, 1150, 385)).toBe(50);
    expect(servicesMenuRight(360, 350, 385)).toBe(8);
  });
});

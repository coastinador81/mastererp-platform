import { expect, it } from 'vitest';
import { usagePanelPosition } from '../model/placement';

const form = { top: 190, bottom: 300, left: 16, right: 344, width: 328 };
const button = { top: 266, bottom: 290, left: 130, right: 154, width: 24 };

it('conserva todo el panel debajo del botón cuando no cabe encima en móvil', () => {
  const result = usagePanelPosition(form, button, 328, { panelHeight: 323, viewportHeight: 640 });
  const top = form.bottom - result.bottom - 323;
  expect(top).toBe(296);
  expect(top + 323).toBeLessThanOrEqual(632);
  expect(result.left).toBe(0);
});

it('limita la posición a la pantalla sin cambiar el tamaño del panel', () => {
  const result = usagePanelPosition(form, button, 328, { panelHeight: 323, viewportHeight: 480 });
  const top = form.bottom - result.bottom - 323;
  expect(top).toBe(8);
  expect(top + 323).toBeLessThanOrEqual(472);
});

it('conserva la posición aprobada sobre el botón cuando hay sitio', () => {
  const lowForm = { ...form, bottom: 700 };
  const lowButton = { ...button, top: 660, bottom: 684 };
  expect(usagePanelPosition(lowForm, lowButton, 328, { panelHeight: 323, viewportHeight: 768 }))
    .toEqual(usagePanelPosition(lowForm, lowButton, 328));
});

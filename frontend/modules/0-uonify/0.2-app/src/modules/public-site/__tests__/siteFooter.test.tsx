import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { SiteFooter } from '../components/footer/SiteFooter';
import { SiteFooterFrame } from '../components/footer/SiteFooterFrame';
import { PREFERENCES_SAVED } from '../hooks/useAccessibilityPreferences';
import { HOME_PREFERENCES_KEY } from '../model/storage';
import { renderPage } from './renderPage';

const stored = () => JSON.parse(sessionStorage.getItem(HOME_PREFERENCES_KEY) ?? 'null') as unknown;

beforeEach(() => {
  sessionStorage.clear();
  delete document.documentElement.dataset.moreContrast;
  delete document.documentElement.dataset.reduceMotion;
});

/** Pinta el pie y abre el menú del globo. */
async function openMenu() {
  const user = userEvent.setup();
  renderPage(<SiteFooter />);
  const globe = screen.getByRole('button', { name: 'Idioma' });
  await user.click(globe);
  return { user, globe, menu: screen.getByRole('dialog', { name: 'Idioma y accesibilidad' }) };
}

describe('pie global', () => {
  test('a la izquierda Partners y Clientes; a la derecha Términos y condiciones, Idioma y Ayuda', () => {
    renderPage(<SiteFooter />);
    const footer = screen.getByRole('contentinfo');
    const left = within(footer).getByRole('navigation', { name: 'Partners y clientes' });
    expect(within(left).getAllByRole('link').map(link => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Partners', '/partners'], ['Clientes', '/clientes'],
    ]);
    const right = within(footer).getByRole('navigation', { name: 'Legal, idioma y ayuda' });
    expect([...right.children].map(child => child.textContent)).toEqual(['Términos y condiciones', 'Idioma', 'Ayuda']);
    expect(within(right).getByRole('link', { name: 'Términos y condiciones' })).toHaveAttribute('href', '/terminos');
    expect(within(right).getByRole('link', { name: 'Ayuda' })).toHaveAttribute('href', '/ayuda');
  });

  test('ya no lleva los enlaces antiguos ni «Preferencias», tampoco con el menú abierto tras un cambio', async () => {
    const user = userEvent.setup();
    renderPage(<SiteFooter />);
    const footer = screen.getByRole('contentinfo');
    for (const name of ['Para equipos y marcas', 'Cómo funciona Uonify', 'Cómo funciona', 'Privacidad', 'Condiciones']) {
      expect(within(footer).queryByRole('link', { name })).toBeNull();
    }
    expect(within(footer).queryByRole('button', { name: 'Preferencias' })).toBeNull();
    expect(footer).not.toHaveTextContent(/Preferencias|Próximamente|En preparación|En desarrollo/);
    // El aviso de estado del menú «Idioma y accesibilidad» tampoco habla de «Preferencias».
    await user.click(within(footer).getByRole('button', { name: 'Idioma' }));
    await user.click(screen.getByRole('checkbox', { name: 'Más contraste' }));
    expect(within(footer).getByRole('status')).toHaveTextContent('Ajustes de accesibilidad guardados para esta pestaña.');
    expect(footer).not.toHaveTextContent(/Preferencias|Próximamente|En preparación|En desarrollo/);
  });

  test('el globo es un botón con aria-haspopup, aria-expanded y aria-controls', async () => {
    renderPage(<SiteFooter />);
    const closed = screen.getByRole('button', { name: 'Idioma' });
    expect(closed).toHaveAttribute('aria-expanded', 'false');
    await userEvent.setup().click(closed);
    const menu = screen.getByRole('dialog', { name: 'Idioma y accesibilidad' });
    expect(closed).toHaveAttribute('aria-haspopup', 'dialog');
    expect(closed).toHaveAttribute('aria-expanded', 'true');
    expect(closed).toHaveAttribute('aria-controls', menu.id);
  });

  test('el menú tiene dos grupos con nombre: Idioma (solo Español, marcado) y Accesibilidad', async () => {
    const { menu } = await openMenu();
    const language = within(menu).getByRole('group', { name: 'Idioma' });
    expect(within(language).getAllByRole('radio')).toHaveLength(1);
    const spanish = within(language).getByRole('radio', { name: 'Español' });
    expect(spanish).toBeChecked();
    // El foco entra en el menú, en el idioma marcado.
    expect(spanish).toHaveFocus();
    expect(menu).not.toHaveTextContent(/English|Inglés|Próximamente|no disponible/);
    const accessibility = within(menu).getByRole('group', { name: 'Accesibilidad' });
    expect(within(accessibility).getAllByRole('checkbox').map(box => box.id)).toEqual(['site-footer-contrast', 'site-footer-motion']);
    expect(within(accessibility).getByRole('checkbox', { name: 'Más contraste' })).not.toBeChecked();
    expect(within(accessibility).getByRole('checkbox', { name: 'Reducir movimiento' })).not.toBeChecked();
    expect(within(accessibility).getByRole('button', { name: 'Restablecer' })).toBeInTheDocument();
  });

  test('los dos interruptores cambian el documento y se guardan en la pestaña; «Restablecer» los quita', async () => {
    const { user, menu } = await openMenu();
    await user.click(within(menu).getByRole('checkbox', { name: 'Más contraste' }));
    expect(document.documentElement.dataset.moreContrast).toBe('true');
    expect(stored()).toEqual({ contrast: true, reduceMotion: false });
    expect(within(menu).getByRole('status')).toHaveTextContent(PREFERENCES_SAVED);
    await user.click(within(menu).getByRole('checkbox', { name: 'Reducir movimiento' }));
    expect(document.documentElement.dataset.reduceMotion).toBe('true');
    expect(stored()).toEqual({ contrast: true, reduceMotion: true });
    await user.click(within(menu).getByRole('button', { name: 'Restablecer' }));
    expect(document.documentElement.dataset).toMatchObject({ moreContrast: 'false', reduceMotion: 'false' });
    expect(stored()).toEqual({ contrast: false, reduceMotion: false });
    expect(within(menu).getByRole('checkbox', { name: 'Más contraste' })).not.toBeChecked();
    expect(within(menu).getByRole('checkbox', { name: 'Reducir movimiento' })).not.toBeChecked();
  });

  test('Escape cierra el menú y devuelve el foco al globo', async () => {
    const { user, globe } = await openMenu();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(globe).toHaveAttribute('aria-expanded', 'false');
    expect(globe).toHaveFocus();
  });

  test('un clic fuera o salir con el tabulador cierran el menú', async () => {
    const { user, globe } = await openMenu();
    await user.click(document.body);
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(globe);
    act(() => screen.getByRole('button', { name: 'Restablecer' }).focus());
    await user.tab();
    expect(screen.getByRole('link', { name: 'Ayuda' })).toHaveFocus();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('al abrirse vacía el estado y al montar aplica las preferencias guardadas en la pestaña', async () => {
    sessionStorage.setItem(HOME_PREFERENCES_KEY, JSON.stringify({ contrast: true, reduceMotion: true }));
    const { user, globe, menu } = await openMenu();
    expect(document.documentElement.dataset).toMatchObject({ moreContrast: 'true', reduceMotion: 'true' });
    expect(within(menu).getByRole('checkbox', { name: 'Más contraste' })).toBeChecked();
    await user.click(within(menu).getByRole('checkbox', { name: 'Más contraste' }));
    await user.keyboard('{Escape}');
    await user.click(globe);
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  test('sin nada guardado, montar el pie no pisa lo que ya tiene el documento y el menú lo muestra', async () => {
    // Por ejemplo, «Reducir movimiento» ya aplicado al entrar en el espacio de trabajo.
    document.documentElement.dataset.reduceMotion = 'true';
    const { menu } = await openMenu();
    expect(document.documentElement.dataset.reduceMotion).toBe('true');
    expect(within(menu).getByRole('checkbox', { name: 'Reducir movimiento' })).toBeChecked();
    expect(within(menu).getByRole('checkbox', { name: 'Más contraste' })).not.toBeChecked();
    expect(stored()).toBeNull();
  });

  test('SiteFooterFrame (pantallas de acceso del espacio): el contenido arriba y el pie como última franja', () => {
    const { container } = renderPage(<SiteFooterFrame><main>Preparando tu espacio</main></SiteFooterFrame>);
    const frame = container.querySelector('.site-footer-frame');
    expect(screen.getAllByRole('contentinfo')).toHaveLength(1);
    expect(frame?.lastElementChild).toBe(screen.getByRole('contentinfo'));
    expect(frame?.firstElementChild).toHaveClass('site-footer-frame__content');
    expect(frame?.firstElementChild).toContainElement(screen.getByRole('main'));
  });

  test('inyecta su propia hoja mientras está montado', () => {
    const { unmount } = renderPage(<SiteFooter />);
    expect(document.head.querySelectorAll('style[data-uon-view-style="site-footer"]')).toHaveLength(1);
    unmount();
    expect(document.head.querySelectorAll('style[data-uon-view-style="site-footer"]')).toHaveLength(0);
  });

  test('sin JS (HTML prerenderizado) el globo es la etiqueta fija «Español», sin botón', () => {
    const html = renderToStaticMarkup(<MemoryRouter><SiteFooter /></MemoryRouter>);
    const footer = new DOMParser().parseFromString(html, 'text/html').querySelector('footer');
    expect(footer).not.toBeNull();
    expect(footer?.querySelector('button, [aria-haspopup], [role="dialog"]')).toBeNull();
    const label = footer?.querySelector('.site-footer__language--fixed');
    expect(label?.textContent).toBe('Idioma: Español');
    expect(label?.querySelector('svg.site-footer__icon')).not.toBeNull();
    expect([...(footer?.querySelectorAll('a') ?? [])].map(link => link.getAttribute('href'))).toEqual(['/partners', '/clientes', '/terminos', '/ayuda']);
  });
});

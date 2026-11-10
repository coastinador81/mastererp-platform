import { useLayoutEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react';
import clsx from 'clsx';
import { useEventListener } from '@/shared/hooks';
import { AVAILABLE_LOCALES, LOCALE_LABELS, useTranslation } from '@/shared/i18n';
import { Button, Checkbox, Icon } from '@/shared/ui';
import { useAccessibilityPreferences } from '../../hooks/useAccessibilityPreferences';
import type { HomePreferences } from '../../model/storage';

/** Id del menú. Es fijo porque hay un solo pie por página y su marcado es idéntico en todas. */
const GLOBE_MENU_ID = 'site-footer-menu';

interface Toggle { key: keyof HomePreferences; id: string; title: string; hint: string }

/** Los dos ajustes de accesibilidad, con los textos del antiguo diálogo «Preferencias». */
const TOGGLES: readonly Toggle[] = [
  { key: 'contrast', id: 'site-footer-contrast', title: 'Más contraste', hint: 'Texto más definido y superficies menos transparentes.' },
  { key: 'reduceMotion', id: 'site-footer-motion', title: 'Reducir movimiento', hint: 'Desactiva animaciones y transiciones. También se respeta la preferencia de tu dispositivo.' },
];

const documentTarget = typeof document === 'undefined' ? null : document;

/**
 * Globo «Idioma» del pie. Abre hacia arriba el menú «Idioma y accesibilidad», un diálogo no
 * modal con dos grupos rotulados:
 * - Idioma: los de AVAILABLE_LOCALES (hoy solo Español), con el activo marcado, como el
 *   globo de Configuración;
 * - Accesibilidad: «Más contraste», «Reducir movimiento» y «Restablecer»
 *   (useAccessibilityPreferences: al instante en <html> y guardadas en la pestaña).
 * El foco entra en el menú al abrirlo; Escape lo cierra y devuelve el foco al globo; un clic
 * fuera o salir con el tabulador también lo cierran.
 */
export function GlobeMenu() {
  const { locale, setLocale } = useTranslation();
  const { preferences, status, change, reset, clearStatus } = useAccessibilityPreferences();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLInputElement>('input')?.focus();
  }, [open]);

  useEventListener('pointerdown', event => {
    if (open && !rootRef.current?.contains(event.target as Node)) setOpen(false);
  }, documentTarget);

  const toggleMenu = () => {
    if (!open) clearStatus();
    setOpen(value => !value);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!open || event.key !== 'Escape') return;
    event.stopPropagation();
    setOpen(false);
    buttonRef.current?.focus();
  };
  // Solo cuando el foco pasa a otro elemento de fuera: un clic en una zona vacía no cierra.
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget as Node | null;
    if (open && next && !rootRef.current?.contains(next)) setOpen(false);
  };

  return (
    <div ref={rootRef} className="site-footer__language" onKeyDown={onKeyDown} onBlur={onBlur}>
      <button
        ref={buttonRef}
        type="button"
        className="site-footer__link"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={GLOBE_MENU_ID}
        onClick={toggleMenu}
      >
        <Icon name="globe" size={16} className="site-footer__icon" />
        Idioma
      </button>
      {open && (
        <div ref={menuRef} id={GLOBE_MENU_ID} className="site-footer__menu" role="dialog" aria-label="Idioma y accesibilidad" tabIndex={-1}>
          <div className="site-footer__group" role="group" aria-labelledby="site-footer-menu-language">
            <p id="site-footer-menu-language" className="site-footer__group-title">Idioma</p>
            {AVAILABLE_LOCALES.map(code => (
              <label key={code} className={clsx('site-footer__option', code === locale && 'is-selected')}>
                <span lang={code}>{LOCALE_LABELS[code]}</span>
                <input
                  type="radio"
                  className="site-footer__control"
                  name="site-footer-locale"
                  value={code}
                  checked={code === locale}
                  onChange={() => setLocale(code)}
                />
              </label>
            ))}
          </div>
          <div className="site-footer__group" role="group" aria-labelledby="site-footer-menu-accessibility">
            <p id="site-footer-menu-accessibility" className="site-footer__group-title">Accesibilidad</p>
            {TOGGLES.map(item => (
              <label key={item.key} className="site-footer__option">
                <span className="site-footer__option-text">
                  <span id={`${item.id}-title`} className="site-footer__option-title">{item.title}</span>
                  <span id={`${item.id}-hint`} className="site-footer__option-hint">{item.hint}</span>
                </span>
                <Checkbox
                  id={item.id}
                  className="site-footer__control"
                  checked={preferences[item.key]}
                  aria-labelledby={`${item.id}-title`}
                  aria-describedby={`${item.id}-hint`}
                  onCheckedChange={checked => change({ ...preferences, [item.key]: checked })}
                />
              </label>
            ))}
            <Button variant="outline" size="sm" className="site-footer__reset" onClick={reset}>Restablecer</Button>
          </div>
          <p className="site-footer__status" role="status" aria-live="polite">{status}</p>
        </div>
      )}
    </div>
  );
}

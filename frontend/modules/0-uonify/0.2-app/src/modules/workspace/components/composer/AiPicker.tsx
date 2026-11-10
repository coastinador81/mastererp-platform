import { useId, useLayoutEffect, useRef, type KeyboardEvent, type RefObject } from 'react';
import { useComposerStore, type Picker } from '../../hooks/composerStore';
import { useDismissOnPointerDown } from '../../hooks/useDismiss';
import { visibleBottom } from '../../hooks/uiStore';
import { EFFORTS, effortLabel, findModel, maxEffortIndex, MODELS, type EffortId } from '../../model/composerOptions';
import { pickerPlacement, toBox } from '../../model/placement';
import { ChevronDownIcon } from '../ShellIcons';

/**
 * Modo rápido, modelo y esfuerzo de razonamiento (composer-tools.js): una frase
 * discreta junto al micrófono; modelo y esfuerzo abren menús de opciones con
 * marca, como los de OpenAI. Las flechas se mueven dentro; Tab sale y cierra.
 */
function placeMenu(panel: HTMLElement, picker: HTMLElement, form: HTMLElement, desired: number): void {
  panel.style.translate = '';
  panel.style.animation = 'none'; // medir sin la animación de apertura
  const place = pickerPlacement({
    picker: toBox(picker),
    form: toBox(form),
    menu: toBox(panel),
    viewportHeight: visibleBottom(),
    viewportWidth: window.innerWidth,
    scrollHeight: panel.scrollHeight,
    desired,
    landing: Boolean(form.closest('.focus-hero')),
  });
  panel.style.animation = '';
  panel.classList.toggle('composer-popover-below', place.below);
  panel.style.maxHeight = `${place.maxHeight}px`;
  if (place.shift) panel.style.translate = `${place.shift}px 0`;
}

function onMenuKeys(event: KeyboardEvent<HTMLDivElement>, selector: string, close: () => void): void {
  if (event.key === 'Tab') {
    close();
    return;
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const options = [...event.currentTarget.querySelectorAll<HTMLElement>(selector)].filter(option => !option.hidden);
  const index = options.indexOf(document.activeElement as HTMLElement);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
  options[next]?.focus();
}

export function AiPicker({ form }: { form: RefObject<HTMLFormElement | null> }) {
  const model = useComposerStore(state => state.model);
  const effort = useComposerStore(state => state.effort);
  const speed = useComposerStore(state => state.speed);
  const picker = useComposerStore(state => state.picker);
  const setPicker = useComposerStore(state => state.setPicker);
  const root = useRef<HTMLDivElement>(null);
  const modelTrigger = useRef<HTMLButtonElement>(null);
  const effortTrigger = useRef<HTMLButtonElement>(null);
  const modelMenu = useRef<HTMLDivElement>(null);
  const effortMenu = useRef<HTMLDivElement>(null);
  const modelMenuId = `composer-model-menu-${useId().replace(/:/g, '')}`;
  const effortMenuId = `composer-effort-menu-${useId().replace(/:/g, '')}`;
  const current = findModel(model);
  const maxIndex = maxEffortIndex(model);

  useDismissOnPointerDown(picker !== null, [root], () => setPicker(null));

  // Al abrir: colocado encima (o debajo si cabe mejor) y el foco en la opción marcada.
  useLayoutEffect(() => {
    const panel = picker === 'model' ? modelMenu.current : picker === 'effort' ? effortMenu.current : null;
    if (!panel || !root.current || !form.current) return;
    placeMenu(panel, root.current, form.current, picker === 'model' ? 470 : 260);
    panel.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
  }, [picker, form]);

  const toggle = (which: Exclude<Picker, null>) => setPicker(picker === which ? null : which);
  const chooseModel = (id: string) => {
    useComposerStore.getState().setModel(id);
    setPicker(null);
    modelTrigger.current?.focus();
  };
  const chooseEffort = (id: EffortId) => {
    useComposerStore.getState().setEffort(id);
    setPicker(null);
    effortTrigger.current?.focus();
  };
  const fast = speed === 'fast';

  return (
    <div className="composer-ai-picker" data-composer-ai-picker="" ref={root}>
      <button
        className="composer-speed-trigger"
        type="button"
        data-speed-toggle=""
        aria-label={fast ? 'Desactivar modo rápido y volver a velocidad normal' : 'Activar modo rápido: 1,5 veces más velocidad y mayor consumo'}
        aria-pressed={fast}
        data-tooltip="Modo rápido (1,5×)"
        data-tooltip-align="start"
        onClick={() => useComposerStore.getState().toggleSpeed()}
      >
        <span className="composer-ai-bolt" aria-hidden="true">ϟ</span>
      </button>
      <button
        ref={modelTrigger}
        className="composer-model-trigger"
        type="button"
        data-composer-model-trigger=""
        aria-label={`Modelo: ${current.label}. Elegir otro modelo`}
        aria-haspopup="menu"
        aria-expanded={picker === 'model'}
        aria-controls={modelMenuId}
        data-tooltip={`Modelo: ${current.label}`}
        onClick={() => toggle('model')}
      >
        {/* La fila del espacio muestra el nombre corto; menú, tooltip y nombre accesible, el completo. */}
        <span data-composer-model-label="">{current.short || current.label}</span>
      </button>
      <button
        ref={effortTrigger}
        className="composer-effort-trigger"
        type="button"
        data-composer-effort-trigger=""
        aria-label={`Esfuerzo: ${effortLabel(effort)}. Ajustar esfuerzo de razonamiento`}
        aria-haspopup="menu"
        aria-expanded={picker === 'effort'}
        aria-controls={effortMenuId}
        data-tooltip="Esfuerzo de razonamiento"
        onClick={() => toggle('effort')}
      >
        <span data-composer-effort-label="">{effortLabel(effort)}</span>
        <ChevronDownIcon className="composer-ai-chevron" />
      </button>
      <div ref={modelMenu} className="composer-model-menu" id={modelMenuId} role="menu" aria-label="Seleccionar modelo" hidden={picker !== 'model'} onKeyDown={event => onMenuKeys(event, '[data-model-id]', () => setPicker(null))}>
        <div className="composer-picker-title">Seleccionar modelo</div>
        {MODELS.map(option => (
          <button key={option.id} type="button" className="composer-model-option" data-model-id={option.id} tabIndex={-1} role="menuitemradio" aria-checked={option.id === model} onClick={() => chooseModel(option.id)}>
            <span className="composer-model-copy">
              <strong>{option.label}</strong>
              {option.detail ? <small>{option.detail}</small> : null}
            </span>
            <span className="composer-option-check" aria-hidden="true">✓</span>
          </button>
        ))}
      </div>
      {/* Esfuerzo: una lista corta de niveles con marca, como la muestra OpenAI. */}
      <div ref={effortMenu} className="composer-effort-menu" id={effortMenuId} role="menu" aria-label="Esfuerzo de razonamiento" hidden={picker !== 'effort'} onKeyDown={event => onMenuKeys(event, '[data-effort-id]', () => setPicker(null))}>
        <div className="composer-picker-title">Esfuerzo de razonamiento</div>
        {EFFORTS.map((option, index) => (
          <button
            key={option.id}
            type="button"
            className="composer-model-option composer-effort-option"
            data-effort-id={option.id}
            tabIndex={-1}
            role="menuitemradio"
            aria-checked={option.id === effort}
            hidden={index > maxIndex}
            onClick={() => chooseEffort(option.id)}
          >
            <span className="composer-model-copy">
              <strong>{option.label}</strong>
            </span>
            <span className="composer-option-check" aria-hidden="true">✓</span>
          </button>
        ))}
      </div>
    </div>
  );
}

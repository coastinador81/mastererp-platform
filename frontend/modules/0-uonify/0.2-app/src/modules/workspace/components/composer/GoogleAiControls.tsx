import { useId, useLayoutEffect, useRef, type KeyboardEvent, type RefObject } from 'react';
import { useComposerStore } from '../../hooks/composerStore';
import { useDismissOnPointerDown } from '../../hooks/useDismiss';
import { visibleBottom } from '../../hooks/uiStore';
import { pickerPlacement, toBox } from '../../model/placement';
import { ChevronDownIcon } from '../ShellIcons';
import { googleSelectionEfforts, type GoogleOptions, type GooglePreferences, type GoogleEffort } from '../../hooks/googlePreferences';
import { googleEffortLabel } from '../../model/googleOptions';

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
  const options = [...event.currentTarget.querySelectorAll<HTMLElement>(selector)].filter(option => !option.hidden && !option.hasAttribute('disabled'));
  const index = options.indexOf(document.activeElement as HTMLElement);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
  options[next]?.focus();
}

interface GoogleAiControlsProps {
  form: RefObject<HTMLFormElement | null>;
  data?: GoogleOptions | null;
  preferences: GooglePreferences;
  enabled: boolean;
  choose: (preferences: GooglePreferences) => void | Promise<void>;
}

/** Modelo y razonamiento disponibles para la cuenta autenticada. */
export function GoogleAiControls({ form, data, preferences: prefs, enabled, choose: save }: GoogleAiControlsProps) {
  const picker = useComposerStore(state => state.picker);
  const setPicker = useComposerStore(state => state.setPicker);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  const current = data?.models.find(model => model.id === prefs.model);
  const models = data?.models ?? [];
  const efforts = data ? googleSelectionEfforts(data, prefs.model) : [];
  const available = efforts.includes(prefs.effort);
  const modelLabel = available ? prefs.model === 'auto' ? 'Auto' : current?.label ?? 'Modelo elegido' : 'Elige tu IA';
  const effortLabel = googleEffortLabel(prefs.effort);
  const shortLabel = available ? prefs.model === 'auto' ? 'Auto' : current?.short ?? modelLabel : 'Elige tu IA';
  const open = picker !== null;
  useDismissOnPointerDown(picker !== null, [root], () => setPicker(null));
  useLayoutEffect(() => {
    const panel = open ? menu.current : null;
    if (panel && root.current && form.current) {
      placeMenu(panel, root.current, form.current, 470);
      (panel.querySelector<HTMLElement>('[aria-checked="true"]:not(:disabled)') ?? panel.querySelector<HTMLElement>('[role="menuitemradio"]:not(:disabled)') ?? panel.querySelector<HTMLElement>('button:not(:disabled)'))?.focus();
    }
  }, [open, form, data]);
  const choose = (model: string, effort: GoogleEffort) => {
    setPicker(null);
    void Promise.resolve(save({ model, effort })).finally(() => requestAnimationFrame(() => trigger.current?.focus()));
  };
  const toggle = () => setPicker(open ? null : 'model');
  return <div ref={root} className="composer-ai-picker" data-composer-ai-picker="" onKeyDown={event => {
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setPicker(null); trigger.current?.focus(); }
  }}>
    <button type="button" className="composer-speed-trigger" disabled={!enabled || !efforts.includes('low')} aria-pressed={prefs.effort === 'low'} aria-label="Respuesta ágil: alternar razonamiento bajo y medio" data-tooltip="Respuesta ágil · razonamiento bajo" onClick={() => {
      if (!efforts.includes('low')) { toggle(); return; }
      choose(prefs.model, prefs.effort === 'low' && efforts.includes('medium') ? 'medium' : 'low');
    }}><span className="composer-ai-bolt" aria-hidden="true">ϟ</span></button>
    <button ref={trigger} type="button" className="composer-model-trigger composer-ai-trigger" data-composer-ai-trigger="" disabled={!enabled} aria-label={`Modelo: ${modelLabel}. Razonamiento: ${effortLabel}. Ajustar IA`} aria-haspopup="menu" aria-expanded={open} aria-controls={`${id}-options`} onClick={toggle}><span data-composer-model-label="">{shortLabel} · {effortLabel}</span><ChevronDownIcon className="composer-ai-chevron" /></button>
    <div ref={menu} className="composer-model-menu" id={`${id}-options`} role="menu" aria-label="Modelo y razonamiento de Google" hidden={!open} onKeyDown={event => onMenuKeys(event, '[role="menuitemradio"]', () => setPicker(null))}>
      <div role="group" aria-label="Modelo de Google">
        <div className="composer-picker-title">Modelo de Google</div>
        {!available && <p className="composer-picker-title">La selección anterior no está disponible. Elige una de estas opciones comprobadas.</p>}
        {[{ id: 'auto', label: 'Auto', detail: data?.autoPolicy ?? '', efforts: data ? googleSelectionEfforts(data, 'auto') : [] }, ...models].map(model => <button key={model.id} type="button" className="composer-model-option" role="menuitemradio" tabIndex={-1} aria-checked={prefs.model === model.id} disabled={!model.efforts.length} onClick={() => choose(model.id, model.efforts.includes(prefs.effort) ? prefs.effort : model.efforts[0])}><span className="composer-model-copy"><strong>{model.label}</strong><small>{model.detail}</small></span><span className="composer-option-check" aria-hidden="true">✓</span></button>)}
      </div>
      <div className="composer-ai-effort-group" role="group" aria-label="Razonamiento">
        <div className="composer-picker-title">Razonamiento</div>
        {data?.efforts.filter(effort => efforts.includes(effort.id)).map(effort => <button key={effort.id} type="button" className="composer-model-option" role="menuitemradio" tabIndex={-1} aria-checked={effort.id === prefs.effort} onClick={() => choose(prefs.model, effort.id)}><span className="composer-model-copy"><strong>{effort.label}</strong><small>{effort.id === 'low' ? 'Tareas sencillas y menor espera' : effort.id === 'medium' ? 'Equilibrio para el trabajo habitual' : 'Más análisis; puede tardar y consumir más'}</small></span><span className="composer-option-check" aria-hidden="true">✓</span></button>)}
      </div>
    </div>
  </div>;
}

import { useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { useEventListener } from '@/shared/hooks';
import { useComposerPreferences } from '../../hooks/useComposerPreferences';
import {
  COMPOSER_EFFORTS, COMPOSER_MODELS, findEffort, findModel, maxEffortIndex, speedLabel, type EffortId,
} from '../../model/composerOptions';
import { horizontalShift, pickerPlacement } from '../../model/placement';
import { PickerMenu } from './PickerMenu';

type OpenMenu = 'model' | 'effort' | null;

/** Coloca el menú abierto como placePicker() del PROTO (arriba o abajo y sin salirse). */
function placeMenu(panel: HTMLElement, picker: HTMLElement, form: HTMLFormElement, desired: number) {
  const bounds = picker.getBoundingClientRect();
  const { below, maxHeight } = pickerPlacement({
    pickerTop: bounds.top,
    pickerBottom: bounds.bottom,
    viewportHeight: window.innerHeight,
    onLanding: Boolean(form.closest('.focus-hero')),
    desired,
    contentHeight: panel.scrollHeight,
  });
  panel.classList.toggle('composer-popover-below', below);
  panel.style.maxHeight = `${maxHeight}px`;
  panel.style.translate = '';
  panel.style.animation = 'none';
  const shift = horizontalShift(panel.getBoundingClientRect(), form.getBoundingClientRect(), window.innerWidth);
  panel.style.animation = '';
  if (shift) panel.style.translate = `${Math.round(shift)}px 0`;
}

/**
 * Selector de IA del compositor: modo rápido, modelo y esfuerzo de razonamiento
 * (composer-tools.js). La elección se guarda por pestaña y la hereda el espacio.
 */
export function ComposerAiPicker({ formRef }: { formRef: RefObject<HTMLFormElement | null> }) {
  const { preferences, setModel, setEffort, toggleSpeed } = useComposerPreferences();
  const [open, setOpen] = useState<OpenMenu>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const effortMenuRef = useRef<HTMLDivElement>(null);
  const modelTriggerRef = useRef<HTMLButtonElement>(null);
  const effortTriggerRef = useRef<HTMLButtonElement>(null);
  const modelMenuId = `composer-model-menu-${useId().replace(/:/g, '')}`;
  const effortMenuId = `composer-effort-menu-${useId().replace(/:/g, '')}`;
  const model = findModel(preferences.model);
  const effort = findEffort(preferences.effort);
  const maxIndex = maxEffortIndex(model.id);

  // Estado legible por otros scripts, como form.dataset del PROTO.
  useLayoutEffect(() => {
    const form = formRef.current;
    if (!form) return;
    form.dataset.aiModel = preferences.model;
    form.dataset.aiEffort = preferences.effort;
    form.dataset.aiSpeed = preferences.speed;
  }, [formRef, preferences]);

  useLayoutEffect(() => {
    const panel = open === 'model' ? modelMenuRef.current : open === 'effort' ? effortMenuRef.current : null;
    if (!panel || !pickerRef.current || !formRef.current) return;
    placeMenu(panel, pickerRef.current, formRef.current, open === 'model' ? 470 : 260);
    panel.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
  }, [open, formRef]);

  useEventListener('pointerdown', event => {
    if (open && !pickerRef.current?.contains(event.target as Node)) setOpen(null);
  }, typeof document === 'undefined' ? null : document);
  useEventListener('keydown', event => {
    if ((event as KeyboardEvent).key !== 'Escape' || !open) return;
    const trigger = open === 'model' ? modelTriggerRef.current : effortTriggerRef.current;
    setOpen(null);
    trigger?.focus();
  }, typeof document === 'undefined' ? null : document);

  const toggle = (menu: Exclude<OpenMenu, null>) => setOpen(current => (current === menu ? null : menu));
  const pickModel = (id: string) => { setModel(id); setOpen(null); modelTriggerRef.current?.focus(); };
  const pickEffort = (id: string) => { setEffort(id as EffortId); setOpen(null); effortTriggerRef.current?.focus(); };

  return (
    <div className="composer-ai-picker" data-composer-ai-picker ref={pickerRef}>
      <button className="composer-speed-trigger" type="button" data-speed-toggle aria-label={speedLabel(preferences.speed)} aria-pressed={preferences.speed === 'fast'} onClick={toggleSpeed}>
        <span className="composer-ai-bolt" aria-hidden="true">ϟ</span>
        <span className="composer-speed-tooltip" role="tooltip"><strong>1.5x speed</strong><small>Mayor consumo</small></span>
      </button>
      <button
        ref={modelTriggerRef}
        className="composer-model-trigger"
        type="button"
        data-composer-model-trigger
        aria-label={`Modelo: ${model.label}. Elegir otro modelo`}
        aria-haspopup="menu"
        aria-expanded={open === 'model'}
        aria-controls={modelMenuId}
        onClick={() => toggle('model')}
      >
        <span data-composer-model-label>{model.label}</span><svg className="composer-ai-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5" /></svg>
      </button>
      <button
        ref={effortTriggerRef}
        className="composer-effort-trigger"
        type="button"
        data-composer-effort-trigger
        aria-label={`Esfuerzo: ${effort.label}. Ajustar esfuerzo de razonamiento`}
        aria-haspopup="menu"
        aria-expanded={open === 'effort'}
        aria-controls={effortMenuId}
        onClick={() => toggle('effort')}
      >
        <span data-composer-effort-label>{effort.label}</span><svg className="composer-ai-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5" /></svg>
      </button>
      <PickerMenu
        ref={modelMenuRef}
        id={modelMenuId}
        className="composer-model-menu"
        optionClassName="composer-model-option"
        optionData="data-model-id"
        title="Seleccionar modelo"
        options={COMPOSER_MODELS}
        selected={model.id}
        open={open === 'model'}
        onPick={pickModel}
        onClose={() => setOpen(null)}
      />
      <PickerMenu
        ref={effortMenuRef}
        id={effortMenuId}
        className="composer-effort-menu"
        optionClassName="composer-model-option composer-effort-option"
        optionData="data-effort-id"
        title="Esfuerzo de razonamiento"
        options={COMPOSER_EFFORTS.map((item, index) => ({ ...item, hidden: index > maxIndex }))}
        selected={effort.id}
        open={open === 'effort'}
        onPick={pickEffort}
        onClose={() => setOpen(null)}
      />
    </div>
  );
}

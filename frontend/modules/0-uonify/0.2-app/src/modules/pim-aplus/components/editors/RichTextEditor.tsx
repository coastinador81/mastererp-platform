import { useCallback, useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import clsx from 'clsx';
import { useEventListener } from '@/shared/hooks';
import { Icon } from '@/shared/ui';
import { editorToPlainText, formatBodyTextForEditor } from '../../model/richText';

/**
 * Editor enriquecido del cuerpo (TextOverlayModule): un solo control con barra de
 * formato. Guarda texto plano con sus saltos de línea (A05); los botones actúan
 * sobre la selección del editor también con teclado (E27).
 */
type Command = 'bold' | 'italic' | 'underline' | 'justifyLeft' | 'justifyCenter';
type Pressed = Record<'bold' | 'italic' | 'underline', boolean>;

const TOGGLES: { cmd: 'bold' | 'italic' | 'underline'; label: string; icon: string }[] = [
  { cmd: 'bold', label: 'Negrita', icon: 'bold' },
  { cmd: 'italic', label: 'Cursiva', icon: 'italic' },
  { cmd: 'underline', label: 'Subrayado', icon: 'underline' },
];
const ALIGN: { cmd: Command; label: string; icon: string }[] = [
  { cmd: 'justifyLeft', label: 'Alinear a la izquierda', icon: 'align-left' },
  { cmd: 'justifyCenter', label: 'Centrar', icon: 'align-center' },
];
const PLACEHOLDER = 'Describe los beneficios y características principales...';

function commandState(cmd: string): boolean {
  try {
    return typeof document.queryCommandState === 'function' ? document.queryCommandState(cmd) : false;
  } catch {
    return false;
  }
}

export interface RichTextEditorProps {
  id: string;
  labelledBy: string;
  describedBy: string;
  formatNoteId: string;
  value: string;
  invalid: boolean;
  onChange: (text: string) => void;
}

export function RichTextEditor({ id, labelledBy, describedBy, formatNoteId, value, invalid, onChange }: RichTextEditorProps) {
  const areaRef = useRef<HTMLDivElement>(null);
  const rangeRef = useRef<Range | null>(null);
  const [pressed, setPressed] = useState<Pressed>({ bold: false, italic: false, underline: false });

  // El texto que llega de fuera (Uony, caché) se pinta; el que sale del propio
  // editor ya coincide, así que no se toca (el cursor no salta).
  useLayoutEffect(() => {
    const area = areaRef.current;
    if (area && editorToPlainText(area) !== value) area.innerHTML = formatBodyTextForEditor(value);
  }, [value]);

  const sync = useCallback(() => {
    const area = areaRef.current;
    if (area) onChange(editorToPlainText(area));
  }, [onChange]);

  const refreshPressed = () => setPressed({ bold: commandState('bold'), italic: commandState('italic'), underline: commandState('underline') });

  useEventListener('selectionchange', () => {
    const selection = document.getSelection();
    const area = areaRef.current;
    if (!selection || !selection.rangeCount || !area) return;
    const node = selection.anchorNode;
    const host = node?.nodeType === Node.ELEMENT_NODE ? (node as Element) : node?.parentElement;
    if (!host || !area.contains(host)) return;
    rangeRef.current = selection.getRangeAt(0).cloneRange();
    refreshPressed();
  }, typeof document === 'undefined' ? null : document);

  // executeCommand: formato sobre la selección del editor (también con teclado).
  const execute = (cmd: Command) => {
    const area = areaRef.current;
    if (!area) return;
    if (document.activeElement !== area) {
      area.focus({ preventScroll: true });
      const range = rangeRef.current;
      const selection = document.getSelection();
      if (range && selection && area.contains(range.startContainer)) {
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }
    try {
      document.execCommand(cmd, false);
    } catch {
      /* sin execCommand */
    }
    sync();
    refreshPressed();
  };

  // Conserva la selección del editor al pulsar un botón de formato.
  const keepSelection = (event: MouseEvent) => {
    if ((event.target as Element).closest?.('[data-cmd]')) event.preventDefault();
  };

  return (
    <div className="pim-aplus-rte">
      <div className="pim-aplus-rte-toolbar" role="toolbar" aria-labelledby={formatNoteId} aria-controls={id} onMouseDown={keepSelection}>
        <span className="pim-aplus-rte-group">
          {TOGGLES.map(tool => (
            <button
              key={tool.cmd}
              type="button"
              className="pim-aplus-tool"
              data-cmd={tool.cmd}
              aria-label={tool.label}
              data-tooltip={tool.label}
              aria-pressed={pressed[tool.cmd]}
              onClick={() => execute(tool.cmd)}
            >
              <Icon name={tool.icon} size={14} />
            </button>
          ))}
        </span>
        <span className="pim-aplus-rte-group">
          {ALIGN.map(tool => (
            <button key={tool.cmd} type="button" className="pim-aplus-tool" data-cmd={tool.cmd} aria-label={tool.label} data-tooltip={tool.label} onClick={() => execute(tool.cmd)}>
              <Icon name={tool.icon} size={14} />
            </button>
          ))}
        </span>
        <span className="pim-aplus-rte-note" id={formatNoteId}>Formato básico disponible</span>
      </div>
      <div
        id={id}
        ref={areaRef}
        className={clsx('pim-aplus-rte-area', !value && 'pim-aplus-rte-empty')}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        data-editor="bodyText"
        data-placeholder={PLACEHOLDER}
        aria-placeholder={PLACEHOLDER}
        spellCheck
        onInput={sync}
        onBlur={sync}
      />
    </div>
  );
}

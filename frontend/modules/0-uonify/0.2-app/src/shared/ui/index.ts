/**
 * Kit de interfaz de Uonify (src/shared/ui). Puerta única: importa siempre desde
 * «@/shared/ui». Carga una vez las hojas del kit (clases pim-* del prototipo).
 * Lista de exportaciones con ejemplos: README.md de esta carpeta.
 */
import './styles/index.css';

// Iconos
export { Icon, type IconProps } from './icons/Icon';
export { UonyMarkDefs } from './icons/UonyMarkDefs';
export { registerIcon, hasIcon, iconHTML, iconMarkup, type IconName } from './icons/registry';

// Botones
export {
  Button,
  IconButton,
  LinkButton,
  buttonClass,
  tooltipAttrs,
  type ButtonProps,
  type ButtonVariant,
  type ButtonSize,
  type IconButtonProps,
  type LinkButtonProps,
  type TooltipProps,
  type TooltipPos,
  type TooltipAlign,
} from './components/Button';

// Insignias, tarjetas y campos
export { Badge, AiMark, type BadgeProps, type BadgeTone, type AiMarkProps } from './components/Badge';
export { Card, CardTitle, type CardProps, type CardVariant, type CardTitleProps } from './components/Card';
export { Field, Label, Hint, ErrorText, Counter, type FieldProps, type LabelProps, type CounterProps } from './components/Field';
export {
  Input,
  Textarea,
  Select,
  type InputProps,
  type TextareaProps,
  type SelectProps,
  type SelectOption,
} from './components/Input';
export { Switch, Checkbox, type SwitchProps, type CheckboxProps } from './components/Switch';

// Progreso, subpestañas, zona de soltar, vacío y alertas
export { Progress, Spinner, type ProgressProps, type SpinnerProps } from './components/Progress';
export {
  SubTabs,
  Segmented,
  type SubTabsProps,
  type SubTabOption,
  type SubTabsMode,
} from './components/SubTabs';
export { Dropzone, type DropzoneProps, type DropzoneRenderApi } from './components/Dropzone';
export { Empty, Alert, type EmptyProps, type AlertProps, type AlertTone } from './components/Feedback';
export { InformationDisclosure } from './components/InformationDisclosure';

// Maquetación
export {
  Head,
  Section,
  SectionHead,
  Toolbar,
  Divider,
  type HeadProps,
  type SectionProps,
  type SectionHeadProps,
} from './components/Section';
export { Meta, KeyValue, type MetaProps, type KeyValueProps, type KeyValueItem } from './components/Meta';
export {
  Stepper,
  Thumb,
  OptionTile,
  type StepperProps,
  type StepItem,
  type StepState,
  type ThumbProps,
  type OptionTileProps,
} from './components/Media';

// Avisos
export { toast, TOAST_DURATION, type ToastApi, type ToastId, type ToastOptions, type ToastType } from './toast/toastStore';
export { Toaster } from './toast/Toaster';

// Diálogos
export { dialog } from './dialog/dialogStore';
export { DialogHost } from './dialog/DialogHost';
export { Dialog, type DialogProps } from './dialog/Dialog';
export type {
  DialogAction,
  DialogControls,
  DialogHandle,
  DialogOptions,
  DialogSize,
  ConfirmOptions,
} from './dialog/types';

// Tooltips [data-tooltip]
export { TooltipDismiss, installTooltipDismiss } from './tooltip/TooltipDismiss';

export { VoiceTalkButton } from './components/VoiceTalkButton';
export { VoiceAudioControls } from './components/VoiceAudioControls';

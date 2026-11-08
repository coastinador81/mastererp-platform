import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Dropzone,
  Field,
  Icon,
  IconButton,
  iconHTML,
  Input,
  KeyValue,
  Meta,
  Progress,
  registerIcon,
  Stepper,
  SubTabs,
  Switch,
  UonyMarkDefs,
} from '@/shared/ui';

describe('componentes del kit', () => {
  test('Button: variantes, tamaños, icono y estado ocupado', () => {
    render(<>
      <Button variant="primary" icon="save">Guardar Cambios</Button>
      <Button variant="ai" size="sm" loading>Generar con Uony</Button>
      <Button>Cancelar</Button>
    </>);
    expect(screen.getByRole('button', { name: 'Guardar Cambios' })).toHaveClass('pim-btn', 'pim-btn-primary');
    const ai = screen.getByRole('button', { name: 'Generar con Uony' });
    expect(ai).toHaveClass('pim-btn-ai', 'pim-btn-sm');
    expect(ai).toHaveAttribute('aria-busy', 'true');
    expect(ai.querySelector('.pim-spin')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toHaveAttribute('type', 'button');
  });

  test('IconButton: nombre accesible y tooltip', () => {
    render(<IconButton icon="trash" label="Eliminar producto" tooltipPos="below" />);
    const button = screen.getByRole('button', { name: 'Eliminar producto' });
    expect(button).toHaveClass('pim-btn-ghost', 'pim-btn-icon');
    expect(button).toHaveAttribute('data-tooltip', 'Eliminar producto');
    expect(button).toHaveAttribute('data-tooltip-pos', 'below');
  });

  test('Icon e iconHTML: registro, desconocido = box, añadir con registerIcon', () => {
    registerIcon('m3d-qr', '<rect width="5" height="5" x="3" y="3" rx="1"/>');
    expect(iconHTML('m3d-qr', 20)).toContain('width="20"');
    expect(iconHTML('m3d-qr')).toContain('<rect width="5"');
    expect(iconHTML('no-existe')).toBe(iconHTML('box'));
    const { container } = render(<Icon name="sparkles" label="IA" />);
    expect(screen.getByRole('img', { name: 'IA' })).toHaveClass('pim-icon');
    expect(container.querySelector('svg')?.innerHTML).toContain('<path');
  });

  test('la marca de Uony es el isotipo «ON» con el degradado de la marca, más ancha que alta', () => {
    expect(iconHTML('uony', 16)).toContain('width="38" height="28" viewBox="0 0 38 28"');
    expect(iconHTML('uony')).toContain('fill:var(--uony-fill,url(#uony-compact-gradient))');
    render(<><UonyMarkDefs /><Icon name="uony" size={12} label="Uony" /></>);
    const mark = screen.getByRole('img', { name: 'Uony' });
    expect(mark).toHaveAttribute('width', '38');
    expect(mark).toHaveAttribute('viewBox', '0 0 38 28');
    expect(document.getElementById('uony-mark-gradient')?.querySelectorAll('stop')).toHaveLength(9);
    expect(iconHTML('sparkles', 16)).toContain('width="16" height="16" viewBox="0 0 24 24"');
  });

  test('Field enlaza etiqueta, ayuda y error con el control', () => {
    render(<Field label="SKU" hint="Identificador único" error="Este SKU ya pertenece a otro producto."><Input mono /></Field>);
    const input = screen.getByRole('textbox', { name: 'SKU' });
    expect(input).toHaveClass('pim-input', 'pim-mono');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Identificador único Este SKU ya pertenece a otro producto.');
  });

  test('Switch alterna aria-checked', async () => {
    function Demo() {
      const [on, setOn] = useState(false);
      return <Switch checked={on} onCheckedChange={setOn} label="Atestación de seguridad" />;
    }
    render(<Demo />);
    const toggle = screen.getByRole('switch', { name: 'Atestación de seguridad' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'true');
  });

  test('SubTabs: pestañas con flechas y opción desactivada con motivo', async () => {
    function Demo() {
      const [view, setView] = useState('library');
      return (
        <SubTabs
          aria-label="Vistas de vídeo"
          value={view}
          onChange={setView}
          options={[
            { value: 'library', label: 'Vídeos del producto', icon: 'video' },
            { value: 'create', label: 'Crear con Uony', icon: 'sparkles' },
            { value: 'ads', label: 'Anuncio', disabled: 'Conecta Amazon Ads' },
          ]}
        />
      );
    }
    render(<Demo />);
    expect(screen.getByRole('tablist', { name: 'Vistas de vídeo' })).toHaveClass('pim-subtabs');
    const library = screen.getByRole('tab', { name: 'Vídeos del producto' });
    expect(library).toHaveAttribute('aria-selected', 'true');
    library.focus();
    await userEvent.keyboard('{ArrowRight}');
    const create = screen.getByRole('tab', { name: 'Crear con Uony' });
    expect(create).toHaveAttribute('aria-selected', 'true');
    expect(create).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    expect(library).toHaveAttribute('aria-selected', 'true');
    const ads = screen.getByRole('tab', { name: /Anuncio/ });
    expect(ads).toHaveAttribute('aria-disabled', 'true');
    expect(ads).toHaveAttribute('data-tooltip', 'Conecta Amazon Ads');
  });

  test('SubTabs radio y conmutador', async () => {
    const onChange = vi.fn();
    const { rerender } = render(<SubTabs mode="radio" aria-label="Formato" value="16:9" onChange={onChange}
      options={[{ value: '16:9', label: '16:9' }, { value: '9:16', label: '9:16' }]} />);
    expect(screen.getByRole('radio', { name: '16:9' })).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(screen.getByRole('radio', { name: '9:16' }));
    expect(onChange).toHaveBeenCalledWith('9:16');
    rerender(<SubTabs mode="toggle" value="preview" onChange={onChange}
      options={[{ value: 'preview', label: 'Vista', icon: 'eye' }, { value: 'code', label: 'HTML', icon: 'code' }]} />);
    expect(screen.getByRole('button', { name: 'Vista' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('Progress: barra accesible limitada a 0-100 y relleno de IA', () => {
    render(<Progress value={140} label="Generando Modelo 3D con Uony" ai />);
    const bar = screen.getByRole('progressbar', { name: 'Generando Modelo 3D con Uony' });
    expect(bar).toHaveClass('pim-progress', 'pim-progress-ai');
    expect(bar).toHaveAttribute('aria-valuenow', '100');
  });

  test('Dropzone: entrega los archivos elegidos', async () => {
    const onFiles = vi.fn();
    render(<Dropzone onFiles={onFiles} accept="image/*" multiple title="Arrastra imágenes aquí" hint="JPG, PNG, WEBP • Máx. 10MB" />);
    const input = screen.getByLabelText('Arrastra imágenes aquí') as HTMLInputElement;
    const file = new File(['x'], 'foto.jpg', { type: 'image/jpeg' });
    await userEvent.upload(input, file);
    expect(onFiles).toHaveBeenCalledWith([file]);
  });

  test('Badge, Alert, Meta, KeyValue y Stepper con las clases del prototipo', () => {
    const { container } = render(<>
      <Badge tone="green">Cuenta conectada</Badge>
      <Alert tone="red" role="alert">No se pudo leer la URL</Alert>
      <Meta items={['12.4 MB', '1080p', null, '0:24']} />
      <KeyValue items={[{ label: 'SKU', value: 'UON-KIT-01', mono: true }]} />
      <Stepper current={1} steps={[{ label: 'Datos' }, { label: 'Análisis' }, { label: 'Resultado' }]} />
    </>);
    expect(screen.getByText('Cuenta conectada')).toHaveClass('pim-badge', 'pim-badge-green');
    expect(screen.getByRole('alert')).toHaveClass('pim-alert', 'pim-alert-red');
    expect(container.querySelectorAll('.pim-meta > span')).toHaveLength(3);
    expect(screen.getByText('UON-KIT-01')).toHaveClass('pim-mono');
    const steps = container.querySelectorAll('.pim-step');
    expect(steps[0]).toHaveClass('is-done');
    expect(steps[1]).toHaveClass('is-active');
    expect(steps[1]).toHaveAttribute('aria-current', 'step');
  });
});

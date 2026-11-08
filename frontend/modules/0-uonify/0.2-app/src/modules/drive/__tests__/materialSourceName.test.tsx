import { render, screen } from '@testing-library/react';
import { MaterialSourceName } from '../components/MaterialSourceName';

it('abre el original en una pestaña nueva con una ruta oficial construida desde el ID', () => {
  const source = { id: '1234567890_source', name: 'Ficha técnica.pdf', url: 'javascript:alert(1)' };
  render(<MaterialSourceName source={source} />);
  const link = screen.getByRole('link', { name: 'Ficha técnica.pdf' });
  expect(link).toHaveAttribute('href', 'https://drive.google.com/file/d/1234567890_source/view');
  expect(link).toHaveAttribute('target', '_blank');
  expect(link).toHaveAttribute('rel', 'noopener noreferrer');
});

it.each(['../unsafe', 'javascript:alert(1)', 'https://evil.test', 'short', 'abc%2Fdef12345'])('deja el nombre como texto si el ID es inválido: %s', id => {
  render(<MaterialSourceName source={{ id, name: 'Archivo original' }} />);
  expect(screen.getByText('Archivo original')).toBeInTheDocument();
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
});

it('mantiene texto legible para una referencia de evidencia sin fuente disponible', () => {
  render(<MaterialSourceName />);
  expect(screen.getByText('Fuente del análisis')).toBeInTheDocument();
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
});

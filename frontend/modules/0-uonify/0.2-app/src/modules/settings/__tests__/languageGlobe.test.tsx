import { fireEvent, render, screen } from '@testing-library/react';
import { LanguageGlobe } from '../components/account/LanguageGlobe';

describe('selector de idioma «mundito»', () => {
  test('muestra el idioma actual y despliega español (elegible) e inglés (próximamente)', () => {
    const onChange = vi.fn();
    render(<LanguageGlobe value="es-ES" onChange={onChange} />);
    const trigger = screen.getByRole('button', { name: /Español/ });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    const spanish = screen.getByRole('option', { name: /Español/ });
    const english = screen.getByRole('option', { name: /English/ });
    expect(spanish).toHaveAttribute('aria-selected', 'true');
    expect(english).toHaveAttribute('aria-disabled', 'true');
  });

  test('el inglés no se puede elegir; el español sí avisa del cambio', () => {
    const onChange = vi.fn();
    render(<LanguageGlobe value="es-ES" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /Español/ }));

    fireEvent.click(screen.getByRole('option', { name: /English/ }));
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('option', { name: /Español/ }));
    expect(onChange).toHaveBeenCalledWith('es-ES');
  });
});

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Alert, LinkButton } from '@/shared/ui';

interface TabBoundaryProps {
  children: ReactNode;
}

interface TabBoundaryState {
  failed: boolean;
}

/**
 * Si una pestaña falla al pintarse, el resto de la ficha (cabecera, pestañas,
 * catálogo) sigue funcionando y se puede volver a intentar.
 */
export class TabBoundary extends Component<TabBoundaryProps, TabBoundaryState> {
  state: TabBoundaryState = { failed: false };

  static getDerivedStateFromError(): TabBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[Producto] Error al pintar la pestaña', error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <Alert tone="red" role="alert" title="No se ha podido abrir esta pestaña">
        Tus datos siguen guardados. <LinkButton onClick={() => this.setState({ failed: false })}>Reintentar</LinkButton>
      </Alert>
    );
  }
}

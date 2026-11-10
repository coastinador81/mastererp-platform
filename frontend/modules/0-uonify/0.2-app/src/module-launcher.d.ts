// Lanzador de apps compartido (frontend/shared/module-launcher): el elemento personalizado no trae tipos.
declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'mastererp-module-launcher': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & { 'current-app'?: string };
    }
  }
}

export {};

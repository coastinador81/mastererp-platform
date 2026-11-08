import type { ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/shared/api/queryClient';
import { DialogHost, Toaster, TooltipDismiss, UonyMarkDefs } from '@/shared/ui';
import { PaywallHost } from '@/modules/billing';

// Proveedores globales y los anfitriones del kit de interfaz (src/shared/ui):
// avisos (toast), diálogos imperativos (dialog.open / dialog.confirm) y el
// Escape que oculta los tooltips [data-tooltip], y el degradado de la marca de Uony.
// Importar el kit carga sus estilos.
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <DialogHost />
      <Toaster />
      <TooltipDismiss />
      <UonyMarkDefs />
      <PaywallHost />
    </QueryClientProvider>
  );
}

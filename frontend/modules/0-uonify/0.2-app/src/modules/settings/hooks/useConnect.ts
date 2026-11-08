import { useMutation, useQueryClient } from '@tanstack/react-query';
import { errorMessage } from '@/shared/api/client';
import { toast } from '@/shared/ui';
import { settingsKeys } from '../api/endpoints';
import { connectProvider, disconnectProvider, renewAmazon } from '../api/settingsApi';
import { isAllowedAuthUrl } from '../model/security';
import type { ConnectResponse, Connections } from '../model/types';

type Provider = 'chatgpt' | 'amazon';
const NAMES: Record<Provider, string> = { chatgpt: 'ChatGPT', amazon: 'Amazon Seller Central' };

/**
 * Conectar, renovar y desconectar proveedores. Con el backend real, conectar
 * devuelve la página de autorización del proveedor (OpenAI o Seller Central) y se
 * vuelve a Configuración › Conexiones; la simulación devuelve ya la conexión.
 */
export function useConnectionActions() {
  const client = useQueryClient();
  const apply = (connections: Connections) => {
    client.setQueryData<Connections>(settingsKeys.connections, connections);
    void client.invalidateQueries({ queryKey: settingsKeys.aiUsage });
  };
  const handle = (provider: Provider, result: ConnectResponse, message: string) => {
    if (result.authUrl) {
      if (isAllowedAuthUrl(result.authUrl)) window.location.assign(result.authUrl);
      else toast.error(`No se ha podido abrir ${NAMES[provider]}`);
      return;
    }
    if (result.connections) apply(result.connections);
    toast.success(message);
  };

  const connect = useMutation({
    mutationFn: connectProvider,
    onSuccess: (result, provider) => handle(provider, result, `${NAMES[provider]} conectado`),
    onError: (reason, provider) => {
      void client.invalidateQueries({ queryKey: settingsKeys.mfa });
      toast.error(`No se ha podido conectar ${NAMES[provider]}`, { description: errorMessage(reason) });
    },
  });
  const renew = useMutation({
    mutationFn: renewAmazon,
    onSuccess: result => handle('amazon', result, 'Autorización de Amazon renovada por 365 días'),
    onError: reason => toast.error('No se ha podido renovar la autorización', { description: errorMessage(reason) }),
  });
  const disconnect = useMutation({
    mutationFn: disconnectProvider,
    onSuccess: (connections, provider) => {
      apply(connections);
      toast.success(`${NAMES[provider]} desconectado`);
    },
    onError: (reason, provider) => toast.error(`No se ha podido desconectar ${NAMES[provider]}`, { description: errorMessage(reason) }),
  });

  return { connect, renew, disconnect };
}

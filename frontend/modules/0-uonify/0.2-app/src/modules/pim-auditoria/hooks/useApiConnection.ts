import { useCallback, useEffect, useRef, useState } from 'react';
import { sleep } from '@/shared/lib';
import { toast } from '@/shared/ui';
import {
  API_CONNECTIONS,
  credentialsLookComplete,
  exampleResults,
  missingRequiredCredentials,
  SIMULATED_CONNECT_MS,
  SIMULATED_SEARCH_MS,
  type ConnectionStatus,
  type ExampleProduct,
} from '../model/apiConnections';

export type ApiTab = 'connect' | 'search';

/**
 * Estado de «Conexiones API Externas» (APIConnectionModal del original). Todo ocurre en
 * el navegador y es una simulación: no hay conexión real, las credenciales no se envían
 * ni se guardan (se pierden al cerrar) y los resultados son de ejemplo.
 */
export function useApiConnection(initialQuery: string, onRefocus: (key: string) => void) {
  const [selectedConnection, setSelectedConnection] = useState('');
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('idle');
  const [searchResults, setSearchResults] = useState<ExampleProduct[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState(initialQuery);
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});
  const [chosenTab, setTab] = useState<ApiTab>('connect');
  // Al cerrar el diálogo a mitad de una espera, no se avisa de un resultado que ya no se ve.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const selected = API_CONNECTIONS.find(connection => connection.id === selectedConnection);
  const searchEnabled = connectionStatus === 'success';
  const tab: ApiTab = searchEnabled ? chosenTab : 'connect';

  const selectPlatform = useCallback((id: string) => {
    setSelectedConnection(id);
    setCredentials({});
    setConnectionStatus('idle');
  }, []);

  const setCredential = useCallback((field: string, value: string) => {
    setCredentials(current => ({ ...current, [field]: value }));
  }, []);

  const togglePassword = useCallback((field: string) => {
    setShowPasswords(current => ({ ...current, [field]: !current[field] }));
  }, []);

  const testConnection = useCallback(async () => {
    if (!selected) return;
    const missing = missingRequiredCredentials(selected, credentials);
    if (missing.length > 0) {
      toast.error(`Completa los campos requeridos: ${missing.join(', ')}`);
      return;
    }
    setIsConnecting(true);
    setConnectionStatus('connecting');
    await sleep(SIMULATED_CONNECT_MS);
    if (!alive.current) return;
    if (credentialsLookComplete(credentials)) {
      setConnectionStatus('success');
      toast.info('Campos completos. Puedes continuar con la búsqueda.');
    } else {
      setConnectionStatus('error');
      toast.error('Credenciales incompletas: revisa que las hayas copiado enteras.');
    }
    setIsConnecting(false);
    onRefocus('api-test');
  }, [selected, credentials, onRefocus]);

  const searchProduct = useCallback(async () => {
    if (!searchQuery.trim()) {
      toast.error('Ingresa un SKU o término de búsqueda');
      return;
    }
    if (connectionStatus !== 'success' || !selected) {
      toast.error('Primero debes establecer una conexión válida');
      return;
    }
    setIsSearching(true);
    await sleep(SIMULATED_SEARCH_MS);
    if (!alive.current) return;
    const results = exampleResults(selected, searchQuery);
    setSearchResults(results);
    if (results.length > 0) toast.success(`${results.length} producto(s) encontrado(s)`);
    else toast.error('No se encontraron productos con ese SKU');
    setIsSearching(false);
    onRefocus('api-search');
  }, [searchQuery, connectionStatus, selected, onRefocus]);

  return {
    selected,
    credentials,
    isConnecting,
    connectionStatus,
    searchResults,
    isSearching,
    searchQuery,
    showPasswords,
    tab,
    searchEnabled,
    setTab,
    setSearchQuery,
    selectPlatform,
    setCredential,
    togglePassword,
    testConnection,
    searchProduct,
  };
}

export type ApiConnectionState = ReturnType<typeof useApiConnection>;

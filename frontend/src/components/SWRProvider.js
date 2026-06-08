'use client';
import { SWRConfig } from 'swr';
import { apiFetcher } from '@/lib/api';

/**
 * Configuração global de SWR.
 *
 * keepPreviousData: ao navegar entre telas, mostra os dados anteriores (em cache)
 * imediatamente enquanto revalida em segundo plano — elimina o "flash em branco
 * + spinner" a cada navegação, que era a principal causa da lentidão percebida.
 */
export default function SWRProvider({ children }) {
  return (
    <SWRConfig
      value={{
        fetcher: apiFetcher,
        keepPreviousData: true,
        revalidateOnFocus: false,
        revalidateIfStale: true,
        dedupingInterval: 15000,
        focusThrottleInterval: 30000,
        errorRetryCount: 2,
      }}
    >
      {children}
    </SWRConfig>
  );
}

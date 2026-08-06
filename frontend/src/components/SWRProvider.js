'use client';
import { SWRConfig } from 'swr';
import { apiFetcher } from '@/lib/api';

/**
 * Configuração global de SWR.
 *
 * keepPreviousData: ao navegar entre telas, mostra os dados anteriores (em cache)
 * imediatamente enquanto revalida em segundo plano — elimina o "flash em branco
 * + spinner" a cada navegação, que era a principal causa da lentidão percebida.
 *
 * revalidateOnFocus estava DESLIGADO, e era metade do "só atualiza com F5":
 * quem saía para outra janela e voltava seguia vendo o retrato antigo, porque
 * nada dispara sozinho num app que já está montado. Ligado com garganta de 30s
 * (focusThrottleInterval) e dedupe de 15s: alt-tab não vira enxurrada de
 * requisição, mas voltar depois de um tempo traz dado fresco.
 */
export default function SWRProvider({ children }) {
  return (
    <SWRConfig
      value={{
        fetcher: apiFetcher,
        keepPreviousData: true,
        revalidateOnFocus: true,
        revalidateOnReconnect: true,
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

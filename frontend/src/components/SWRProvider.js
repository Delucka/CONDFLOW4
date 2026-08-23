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

const CHAVE_CACHE = 'condoflow_swr_v1';
// O painel inteiro pesa ~70 KB. O teto existe para o cache nunca virar um
// problema por si: localStorage estoura perto de 5 MB e, quando estoura, a
// escrita falha e leva junto o que já estava lá.
const TETO_BYTES = 1_500_000;

/**
 * O cache do SWR sobrevive ao fechar a aba.
 *
 * Sem isto, abrir o app é sempre partir do zero: tela vazia, spinner, e a espera
 * inteira das idas ao banco. Como cada ida custa 250-500 ms na instância atual
 * do Supabase (medido), a primeira pintura demorava segundos.
 *
 * Guardando o último estado conhecido, a tela aparece PREENCHIDA no instante em
 * que abre — com os números da última visita — e o SWR corrige sozinho quando a
 * resposta nova chega. É o que faz a espera deixar de existir para quem usa,
 * mesmo sem nenhuma consulta ter ficado mais rápida.
 *
 * O que fica guardado é o que a pessoa já via na tela, no navegador dela. Some
 * no logout (`limparCachePersistido`, chamado pelo AuthProvider) e some também
 * quando o formato muda, pela versão na chave.
 */
function provedorPersistente() {
  if (typeof window === 'undefined') return new Map();

  let inicial = [];
  try {
    inicial = JSON.parse(localStorage.getItem(CHAVE_CACHE) || '[]');
  } catch {
    // Cache corrompido não pode derrubar o app: começa vazio e segue.
    inicial = [];
  }
  const mapa = new Map(inicial);

  const salvar = () => {
    try {
      // Só respostas de leitura da API. Chave que não seja string é estado
      // interno do SWR, e erro guardado reapareceria como erro na abertura
      // seguinte, mesmo com tudo funcionando.
      // Guarda SO o dado, nunca o objeto interno do SWR.
      //
      // Aquele objeto carrega os carimbos de tempo da ultima busca. Restaurados
      // do disco, faziam o SWR acreditar que a busca tinha acabado de
      // acontecer: ele nao pedia nada novo ao abrir, e o painel mostrava o
      // retrato da visita anterior como se fosse de agora. Sem os carimbos, o
      // dado antigo serve para pintar na hora e a busca acontece assim mesmo.
      const entradas = [...mapa.entries()]
        .filter(([k, v]) => typeof k === 'string' && k.startsWith('/api/') && v && v.data !== undefined && !v.error)
        .map(([k, v]) => [k, { data: v.data }]);
      const texto = JSON.stringify(entradas);
      if (texto.length > TETO_BYTES) return;
      localStorage.setItem(CHAVE_CACHE, texto);
    } catch { /* cota cheia ou modo privado: seguir sem persistir */ }
  };

  // `pagehide` em vez de `beforeunload`: no celular a aba costuma ser congelada
  // sem nunca disparar `beforeunload`, e aí nada seria salvo justamente onde a
  // espera dói mais.
  window.addEventListener('pagehide', salvar);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') salvar();
  });

  return mapa;
}

/** Chamado no logout: o cache guarda dado de quem estava logado. */
export function limparCachePersistido() {
  try { localStorage.removeItem(CHAVE_CACHE); } catch { /* ignora */ }
}

export default function SWRProvider({ children }) {
  return (
    <SWRConfig
      value={{
        provider: provedorPersistente,
        fetcher: apiFetcher,
        keepPreviousData: true,
        revalidateOnFocus: true,
        revalidateOnReconnect: true,
        revalidateIfStale: true,
        // Explícito, e não por acaso.
        //
        // O cache agora sobrevive ao fechar a aba, e o SWR não tem como saber a
        // idade do que veio do disco: ele tratava o dado restaurado como fresco
        // e não buscava nada ao montar. A tela abria preenchida e ficava —
        // que e exatamente o "só atualiza com F5" que já tínhamos consertado uma
        // vez. Pintar do cache e revalidar sempre são as duas metades da mesma
        // ideia; sem a segunda, isto vira dado velho com cara de novo.
        revalidateOnMount: true,
        dedupingInterval: 15000,
        focusThrottleInterval: 30000,
        errorRetryCount: 2,
      }}
    >
      {children}
    </SWRConfig>
  );
}

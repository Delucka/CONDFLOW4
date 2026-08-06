'use client';
import { useEffect, useRef } from 'react';

/**
 * Rebusca quando a pessoa VOLTA para a tela.
 *
 * As telas que falam direto com o Supabase (Central de Emissões, Registro, Fila)
 * buscam uma vez, na montagem, e depois dependem só do realtime. Quando o
 * realtime não cobre a tabela — ou o navegador dorme a aba e derruba o
 * websocket — a tela fica congelada no retrato antigo até um F5. Era o "só
 * atualiza com F5".
 *
 * O SWR já faz isso sozinho (`revalidateOnFocus`); este hook é o equivalente
 * para quem não usa SWR.
 *
 * Dois gatilhos, porque nenhum cobre tudo: `visibilitychange` pega trocar de
 * aba, `focus` pega voltar de outra janela com a aba já visível.
 *
 * @param {Function} fn        o que rebuscar
 * @param {number}   esperaMs  garganta: ignora chamadas mais próximas que isso
 */
export function useRevalidarAoVoltar(fn, esperaMs = 20000) {
  const fnRef = useRef(fn);
  fnRef.current = fn;               // sempre a versão atual, sem reassinar eventos
  const ultimaRef = useRef(Date.now());

  useEffect(() => {
    function talvezRebuscar() {
      if (document.visibilityState !== 'visible') return;
      const agora = Date.now();
      if (agora - ultimaRef.current < esperaMs) return;
      ultimaRef.current = agora;
      try { fnRef.current?.(); } catch { /* rebusca é oportunista, nunca derruba a tela */ }
    }
    document.addEventListener('visibilitychange', talvezRebuscar);
    window.addEventListener('focus', talvezRebuscar);
    return () => {
      document.removeEventListener('visibilitychange', talvezRebuscar);
      window.removeEventListener('focus', talvezRebuscar);
    };
  }, [esperaMs]);
}

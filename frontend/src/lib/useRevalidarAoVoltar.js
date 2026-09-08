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
  // Atribuido num efeito, nao durante o render: mexer em `ref.current` no
  // corpo do componente torna o render impuro, e o React pode descartar e
  // refazer esse render. O efeito roda antes de qualquer clique ou troca de
  // aba, entao a funcao ja esta atualizada quando alguem precisa dela.
  useEffect(() => { fnRef.current = fn; });
  // Zero, e nao `Date.now()`: ler o relogio durante o render torna o
  // componente impuro — dois renders seguidos dariam valores diferentes. O
  // efeito abaixo carimba a hora na montagem, que e quando ela importa.
  const ultimaRef = useRef(0);

  useEffect(() => {
    if (ultimaRef.current === 0) ultimaRef.current = Date.now();

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

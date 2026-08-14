'use client';
import { useEffect, useRef } from 'react';
import { createClient } from '@/utils/supabase/client';

/**
 * Assinatura de tempo real compartilhada: UMA por tabela, por aba.
 *
 * O QUE ESTAVA ERRADO
 *
 * Oito lugares assinavam `emissoes_pacotes` cada um com o seu canal. Não era
 * problema de conexão — o client é singleton e o Supabase multiplexa todos os
 * canais num único websocket. O problema é a AMPLIFICAÇÃO:
 *
 *   1 INSERT no banco → 8 callbacks na mesma aba → 8 rebuscas completas
 *
 * Aprovar um pacote disparava a lista do master, a do emissor, a do gerente, a
 * fila de ocorrências, o sino, os meses travados e a expedição — todos
 * recarregando ao mesmo tempo, para mostrar a mesma mudança.
 *
 * COMO ESTE ARQUIVO RESOLVE
 *
 * Uma assinatura por tabela, com os interessados registrados numa lista. O
 * servidor avalia a mudança uma vez; cada tela é avisada localmente.
 *
 * E um respiro de 400ms: mudar o status de um pacote costuma vir acompanhado de
 * escritas na trilha e nos arquivos, em rajada. Sem o respiro, cada uma dispara
 * a sua rebusca. Com ele, a rajada vira uma.
 */

// tabela -> { canal, ouvintes:Set, timer }
const registro = new Map();

function assinar(tabela, callback) {
  const supabase = createClient();
  let entrada = registro.get(tabela);

  if (!entrada) {
    entrada = { canal: null, ouvintes: new Set(), timer: null };
    registro.set(tabela, entrada);

    entrada.canal = supabase
      .channel(`compartilhado_${tabela}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: tabela }, () => {
        // Respiro: agrupa a rajada num aviso só.
        clearTimeout(entrada.timer);
        entrada.timer = setTimeout(() => {
          entrada.ouvintes.forEach((fn) => {
            try { fn(); } catch { /* um ouvinte quebrado não derruba os outros */ }
          });
        }, 400);
      })
      .subscribe();
  }

  entrada.ouvintes.add(callback);

  return () => {
    entrada.ouvintes.delete(callback);
    // Último a sair fecha a porta: sem isto o canal fica vivo depois que a tela
    // sumiu, recebendo evento para ninguém.
    if (entrada.ouvintes.size === 0) {
      clearTimeout(entrada.timer);
      supabase.removeChannel(entrada.canal);
      registro.delete(tabela);
    }
  };
}

/**
 * Avisa quando qualquer linha das tabelas mudar.
 *
 * @param {string[]} tabelas  nomes das tabelas a observar
 * @param {Function} aoMudar  o que fazer (normalmente, rebuscar)
 *
 * O callback fica num ref: passar uma função nova a cada render não reassina
 * nada, então dá para escrever `useRealtime(['x'], () => fetch())` sem
 * `useCallback` e sem recriar canal a cada digitação.
 */
export function useRealtime(tabelas, aoMudar) {
  const ref = useRef(aoMudar);
  // Efeito sem lista de dependências: roda depois de todo render. Escrever o ref
  // direto no corpo funcionaria, mas é escrita durante o render — o React proíbe.
  // O aviso só é usado no evento do banco, que é assíncrono; guardar depois do
  // render chega a tempo.
  useEffect(() => { ref.current = aoMudar; });

  // A lista vira string para o efeito não reassinar quando o array é recriado
  // com o mesmo conteúdo — que é o que acontece a cada render.
  const chave = (tabelas || []).join('|');

  useEffect(() => {
    const nomes = chave ? chave.split('|') : [];
    const cancelar = nomes.map((t) => assinar(t, () => ref.current?.()));
    return () => cancelar.forEach((fn) => fn());
  }, [chave]);
}

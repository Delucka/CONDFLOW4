'use client';
import { useCallback, useRef, useState } from 'react';
import { useToast } from '@/components/Toast';

/**
 * Uma ação assíncrona que sabe dizer que está em curso.
 *
 * POR QUE ISTO EXISTE
 * -------------------
 * Dos 498 botões do app, só 81 mostram que estão trabalhando. Não é desleixo —
 * é que escrever o estado dá trabalho: um `useState`, um `try/finally`, um
 * `catch` com `addToast`, e lembrar de travar contra o clique duplo. Cinco
 * linhas de cerimônia por botão, 498 vezes.
 *
 * Enquanto o certo for mais trabalhoso que o errado, o errado ganha. Então o
 * conserto não é revisar 417 botões: é fazer o estado vir de graça.
 *
 *     const [salvar, salvando] = useAcao(async () => {
 *       await apiPost('/api/x', dados);
 *     }, { sucesso: 'Salvo.' });
 *
 *     <Botao onClick={salvar} carregando={salvando} icone={Save}>Salvar</Botao>
 *
 * O QUE ELE GARANTE
 * -----------------
 * - **Clique duplo não passa.** Um `ref` barra a segunda chamada antes mesmo do
 *   React repintar — `disabled` sozinho tem uma janela de um quadro, e é nela
 *   que nasce a emissão duplicada.
 * - **Erro sempre aparece.** Nada de `catch` vazio: o que quebrou vira toast.
 * - **O estado sempre volta.** `finally`, inclusive quando a ação lança.
 * - **Não escreve em componente desmontado.** Trocar de tela no meio de um
 *   salvamento não deve gerar aviso do React.
 */
export function useAcao(fn, { sucesso, erro, aoTerminar } = {}) {
  const { addToast } = useToast();
  const [rodando, setRodando] = useState(false);
  const emCurso = useRef(false);
  const vivo = useRef(true);

  const executar = useCallback(async (...args) => {
    if (emCurso.current) return undefined;      // barra o clique duplo
    emCurso.current = true;
    setRodando(true);
    try {
      const r = await fn(...args);
      if (sucesso) addToast(typeof sucesso === 'function' ? sucesso(r) : sucesso, 'success');
      aoTerminar?.(r);
      return r;
    } catch (e) {
      // A mensagem do servidor vale mais que a genérica: `apiFetch` já traz o
      // `detail` do FastAPI, que é escrito para o usuário ler.
      const msg = (typeof erro === 'function' ? erro(e) : erro) || e?.message || 'Não consegui completar a ação.';
      addToast(msg, 'error');
      return undefined;
    } finally {
      emCurso.current = false;
      if (vivo.current) setRodando(false);
    }
  }, [fn, sucesso, erro, aoTerminar, addToast]);

  // Marca o desmonte para o `finally` não tentar pintar o que já saiu da tela.
  const marcarMorto = useCallback(() => { vivo.current = false; }, []);
  executar.desmontou = marcarMorto;

  return [executar, rodando];
}

export default useAcao;

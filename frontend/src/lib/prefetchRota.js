import { preload } from 'swr';
import { apiFetcher } from '@/lib/api';

/**
 * Começar a buscar os dados da tela ANTES do clique.
 *
 * O Next já busca sozinho o código da rota quando o link entra na tela ou
 * recebe o mouse. O que ele não busca são os nossos dados: eles vivem em
 * `useSWR` dentro de componentes de cliente, e só disparam depois que a página
 * nova montou. Resultado: o usuário clica, a tela troca na hora, e aí começa a
 * espera.
 *
 * Com o banco a 185 ms daqui, essa espera é de meio segundo para cima. O tempo
 * entre o mouse chegar no item do menu e o dedo apertar é quase sempre maior
 * que isso — então a resposta já está de volta quando a tela pede.
 *
 * Só entram aqui chaves que dá para reproduzir **exatamente** como a tela vai
 * pedir. Chave diferente por um caractere é uma requisição paga e jogada fora.
 * O painel ficou de fora por isso: a chave dele carrega mês, ano e filtro de
 * gerente, que só existem lá dentro.
 */
const CHAVES_POR_ROTA = {
  '/condominios': ['/api/condominios'],
  '/carteiras/cobrancas': ['/api/condominios?basico=1'],
  '/carteiras/segundas-vias': ['/api/condominios?basico=1', '/api/segundas-vias'],
  '/consumos': ['/api/consumos/condominios-com-faturas'],
  '/aprovacoes': ['/api/aprovacoes'],
};

// Central de Emissões, Expedição e Correios não aparecem aqui: elas falam com o
// Supabase direto, sem passar pelo SWR, então não há chave para adiantar.

const JANELA = 30000;
const pedidos = new Map();   // chave -> quando foi adiantada

export function prefetchRota(href) {
  const chaves = CHAVES_POR_ROTA[href];
  if (!chaves) return;

  // Quem pediu para economizar dados não quer que a gente busque o que talvez
  // nem seja aberto.
  try {
    if (navigator?.connection?.saveData) return;
  } catch { /* navegador sem a API: segue */ }

  const agora = Date.now();
  for (const chave of chaves) {
    // Sem esta janela, ir e voltar com o mouse pelo menu vira uma rajada de
    // requisições iguais. Curta de propósito: adiantar dado velho é pior que
    // não adiantar — a tela mostra o cache e revalida sozinha ao montar.
    if (agora - (pedidos.get(chave) || 0) < JANELA) continue;
    pedidos.set(chave, agora);
    try {
      preload(chave, apiFetcher);
    } catch {
      // Adiantar é otimização: falhar aqui não pode aparecer para o usuário.
      // A tela vai pedir de novo ao montar, do jeito de sempre.
      pedidos.delete(chave);
    }
  }
}

/** Handlers prontos para pendurar num link do menu. */
export function aoAproximar(href) {
  return {
    onMouseEnter: () => prefetchRota(href),
    onFocus: () => prefetchRota(href),
    onTouchStart: () => prefetchRota(href),
  };
}

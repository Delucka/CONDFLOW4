'use client';

// Cargos que PRECISAM aprovar em cada nível de fluxo (fonte da verdade)
export const FLUXO_ROLES = {
  1: ['supervisora_contabilidade'],
  2: ['gerente', 'supervisora_contabilidade'],
  3: ['gerente', 'supervisora_contabilidade'],
  4: ['gerente', 'supervisor_gerentes', 'supervisora_contabilidade'],
};

// Status "aguardando" por cargo (reconhecidos por isMinhaAprovacao + StatusBadge)
const PENDING_BY_ROLE = {
  gerente: 'pendente_gerente',
  supervisor_gerentes: 'pendente_sup_gerentes',
  supervisora_contabilidade: 'pendente_sup_contabilidade',
  supervisora: 'pendente_sup_contabilidade',
};

export function aprovadoresDoNivel(nivel) {
  return FLUXO_ROLES[Number(nivel) || 1] || FLUXO_ROLES[1];
}

// supervisora conta como supervisora_contabilidade
function satisfaz(roleSet, required) {
  return roleSet.has(required) || (required === 'supervisora_contabilidade' && roleSet.has('supervisora'));
}

// Considera só as aprovações do CICLO ATUAL — as que vieram DEPOIS da última
// correção. Pedir correção "retira" as aprovações anteriores (re-conferência do zero).
export function aprovacoesValidas(aprovacoes) {
  const arr = aprovacoes || [];
  let ultCorrecao = 0;
  for (const a of arr) {
    if (a.acao === 'correcao') {
      const t = new Date(a.criado_em).getTime();
      if (t > ultCorrecao) ultCorrecao = t;
    }
  }
  return arr.filter(a => a.acao !== 'correcao' && new Date(a.criado_em).getTime() > ultCorrecao);
}

/**
 * Grava uma linha na trilha de aprovação — e DEVOLVE o erro.
 *
 * Existe porque os seis lugares que gravavam isso faziam
 * `await supabase.from(...).insert({...})` sem ler o retorno. O supabase-js
 * DEVOLVE `{error}` em vez de lançar, então uma recusa do banco passava como
 * sucesso.
 *
 * E aqui a falha calada é cara: a trilha é o que `aprovacoesValidas()` conta
 * para decidir se todos assinaram. Linha faltando = assinatura que não existe.
 * Do lado da aprovação, o pacote fica preso esperando alguém que já assinou; do
 * lado da correção, as aprovações anteriores NÃO são anuladas e o pacote pode
 * seguir para registro sem a reconferência. É o mesmo tipo de defeito que fez
 * todo processo ser aprovado direto, pulando os supervisores.
 *
 * @returns {{ error: any }} nunca lança — quem chama decide o que fazer
 */
export async function registrarNaTrilha(supabase, { pacoteId, pacoteIds, acao, user }) {
  const ids = pacoteIds || [pacoteId];
  const linhas = ids.filter(Boolean).map((id) => ({
    pacote_id: id,
    acao,
    role: user?.role || null,
    usuario_nome: user?.full_name || null,
    usuario_email: user?.email || null,
  }));
  if (!linhas.length) return { error: null };
  const { error } = await supabase.from('emissoes_pacotes_aprovacoes').insert(linhas);
  return { error };
}

/** Mensagem única para a falha acima — o usuário precisa saber o que ficou torto. */
export function avisoTrilhaFalhou(acao, error) {
  const oQue = acao === 'correcao'
    ? 'a correção foi registrada, mas a trilha não'
    : 'a aprovação foi salva, mas a trilha não';
  return `${oQue}: ${error?.message || error}. Avise o admin — a contagem de assinaturas deste pacote pode ficar errada.`;
}

// Cargos que ainda faltam aprovar (a partir do pacote.aprovacoes já carregado)
export function faltamAprovar(pacote) {
  const ap = new Set(aprovacoesValidas(pacote?.aprovacoes).map(a => a.role));
  return aprovadoresDoNivel(pacote?.nivel_aprovacao).filter(r => !satisfaz(ap, r));
}

export function todosAprovaram(pacote) {
  // Legado: pacotes aprovados antes da trilha existir (sem nenhum registro)
  if ((pacote?.aprovacoes || []).length === 0 && pacote?.aprovado_em) return true;
  return faltamAprovar(pacote).length === 0;
}

// Próximo status após `userRole` aprovar — relê a trilha atual no banco (robusto a
// divergências de status). Só vira 'aprovado' quando TODOS os cargos do nível assinaram
// no ciclo atual (aprovações anteriores a uma correção não contam).
export async function proximoStatusAprovacao(supabase, pacoteId, nivel, userRole) {
  const { data } = await supabase
    .from('emissoes_pacotes_aprovacoes')
    .select('role, acao, criado_em')
    .eq('pacote_id', pacoteId);
  const ap = new Set(aprovacoesValidas(data).map(a => a.role));
  if (userRole) ap.add(userRole);
  const faltam = aprovadoresDoNivel(nivel).filter(r => !satisfaz(ap, r));
  if (faltam.length === 0) return 'aprovado';
  return PENDING_BY_ROLE[faltam[0]] || 'pendente_sup_contabilidade';
}

/**
 * Para quem a emissão volta depois de corrigida: quem PEDIU a correção.
 *
 * O fluxo antigo recomeçava do início do nível — e o nível vinha do modal, não
 * do pacote. Resultado: o gerente pedia correção, o emissor corrigia, e a
 * emissão ia parar na supervisora de contabilidade sem passar pelo gerente. A
 * pessoa que apontou o erro nunca via se ele foi resolvido.
 *
 * Quem pediu a correção é o primeiro a reconferir. Os demais vêm depois, na
 * ordem normal, porque `aprovacoesValidas()` já anula as assinaturas anteriores
 * à correção — ninguém "herda" uma aprovação dada antes do erro.
 *
 * @returns {string|null} status de espera, ou null quando não há correção na
 *                        trilha (aí o chamador segue o caminho normal)
 */
export async function statusDeVoltaAposCorrecao(supabase, pacoteId) {
  const { data, error } = await supabase
    .from('emissoes_pacotes_aprovacoes')
    .select('role, acao, criado_em')
    .eq('pacote_id', pacoteId)
    .eq('acao', 'correcao')
    .order('criado_em', { ascending: false })
    .limit(1);

  if (error || !data?.length) return null;
  const role = data[0].role;
  // Correção pedida por quem não é aprovador (master, emissão) não define
  // volta: nesse caso o caminho normal do nível é o certo.
  return PENDING_BY_ROLE[role] || null;
}

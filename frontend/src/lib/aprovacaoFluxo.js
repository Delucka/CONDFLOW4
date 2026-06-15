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

// Cargos que ainda faltam aprovar (a partir do pacote.aprovacoes já carregado)
export function faltamAprovar(pacote) {
  const ap = new Set((pacote?.aprovacoes || []).filter(a => a.acao !== 'correcao').map(a => a.role));
  return aprovadoresDoNivel(pacote?.nivel_aprovacao).filter(r => !satisfaz(ap, r));
}

export function todosAprovaram(pacote) {
  // Legado: pacotes aprovados antes da trilha existir (sem registro nominal)
  if ((pacote?.aprovacoes || []).length === 0 && pacote?.aprovado_em) return true;
  return faltamAprovar(pacote).length === 0;
}

// Próximo status após `userRole` aprovar — relê a trilha atual no banco (robusto a
// divergências de status). Só vira 'aprovado' quando TODOS os cargos do nível assinaram.
export async function proximoStatusAprovacao(supabase, pacoteId, nivel, userRole) {
  const { data } = await supabase
    .from('emissoes_pacotes_aprovacoes')
    .select('role, acao')
    .eq('pacote_id', pacoteId);
  const ap = new Set((data || []).filter(a => a.acao !== 'correcao').map(a => a.role));
  if (userRole) ap.add(userRole);
  const faltam = aprovadoresDoNivel(nivel).filter(r => !satisfaz(ap, r));
  if (faltam.length === 0) return 'aprovado';
  return PENDING_BY_ROLE[faltam[0]] || 'pendente_sup_contabilidade';
}

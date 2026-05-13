'use client';
export const ROLE_LABELS = {
  master: 'Master',
  gerente: 'Gerente',
  assistente: 'Assistente',
  supervisora: 'Supervisora',
  supervisora_contabilidade: 'Sp. Contabilidade',
  supervisor_gerentes: 'Sup. Gerentes',
  departamento: 'Departamento',
  sindico: 'Síndico',
  outros: 'Usuário',
};

export const ROUTE_ACCESS = {
  '/dashboard':           ['master','gerente','assistente','supervisora','supervisora_contabilidade','supervisor_gerentes','departamento','sindico'],
  '/condominios':         ['master','gerente','assistente','supervisora','supervisora_contabilidade','supervisor_gerentes','departamento','sindico'],
  '/carteiras/cobrancas': ['master','gerente','assistente'],
  '/aprovacoes':          ['master','gerente','supervisora','supervisora_contabilidade','supervisor_gerentes','departamento'],
  '/central-emissoes':    ['master','gerente','departamento','supervisora','supervisora_contabilidade','supervisor_gerentes'],
  '/admin/usuarios':      ['master'],
  '/condominio':          ['master','gerente','assistente','supervisora','supervisora_contabilidade','departamento'],
  '/seed':                ['master'],
};

// Fonte da verdade RBAC — espelhado em api/auth_constants.py
export const CAPABILITIES = {
  edit_planilha:           ['master','gerente'],
  edit_cobrancas_extras:   ['master','gerente','assistente'],
  approve_document:        ['master','gerente','supervisora','supervisora_contabilidade','supervisor_gerentes'],
  sign_document:           ['master','gerente','supervisora','supervisora_contabilidade','supervisor_gerentes'],
  manage_users:            ['master'],
  emit_document:           ['master','departamento'],
  view_planilha:           ['master','gerente','assistente','supervisora','supervisora_contabilidade','supervisor_gerentes','departamento','sindico'],
  view_auditoria:          ['master','supervisora','supervisora_contabilidade','supervisor_gerentes','departamento'],
  pipeline_override:       ['master'],
  dashboard_filter_gerente:['master','supervisora','supervisora_contabilidade','supervisor_gerentes','departamento'],
};

export function canAccessPath(userRole, path) {
  if (!userRole) return false;
  if (userRole === 'master') return true;
  const keys = Object.keys(ROUTE_ACCESS).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (path === key || path.startsWith(key + '/')) {
      return ROUTE_ACCESS[key].includes(userRole);
    }
  }
  return false;
}

export function can(userRole, capability) {
  if (!userRole || !CAPABILITIES[capability]) return false;
  if (userRole === 'master') return true;
  return CAPABILITIES[capability].includes(userRole);
}

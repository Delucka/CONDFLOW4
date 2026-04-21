// ═══════════════════════════════════════════════════════════════════
// CondoFlow — Mapa central de Roles (RBAC)
// Fonte única de verdade para permissões no frontend.
// O backend (api_routes.py) replica essas regras em cada endpoint.
// ═══════════════════════════════════════════════════════════════════

export const ROLES = {
  MASTER: 'master',
  GERENTE: 'gerente',
  ASSISTENTE: 'assistente',
  SUPERVISORA: 'supervisora',
  SUPERVISORA_CONTABILIDADE: 'supervisora_contabilidade',
  EMISSOR: 'emissor',
};

export const ROLE_LABELS = {
  master: 'Master',
  gerente: 'Gerente',
  assistente: 'Assistente',
  supervisora: 'Supervisora',
  supervisora_contabilidade: 'Sp. Contabilidade',
  emissor: 'Emissor',
};

// Mapa de ACESSO às rotas do menu.
// Cada chave é o path base; valor é lista de roles que podem ENTRAR.
export const ROUTE_ACCESS = {
  '/dashboard': ['master', 'gerente', 'assistente', 'supervisora', 'supervisora_contabilidade', 'emissor'],
  '/condominios': ['master', 'gerente', 'assistente', 'supervisora', 'supervisora_contabilidade', 'emissor'],
  '/carteiras': ['master'],
  '/carteiras/cobrancas': ['master', 'gerente', 'assistente'],
  '/aprovacoes': ['master', 'gerente', 'supervisora', 'supervisora_contabilidade'],
  '/central-emissoes': ['master', 'gerente', 'emissor'],
  '/admin/usuarios': ['master'],
  '/condominio': ['master', 'gerente', 'assistente', 'supervisora', 'supervisora_contabilidade', 'emissor'],
};

// Mapa de AÇÕES dentro das telas (edição, aprovação, etc)
// Use com: can(userRole, 'edit_planilha')
export const CAPABILITIES = {
  edit_planilha: ['master', 'gerente'],
  edit_cobrancas_extras: ['master', 'gerente', 'assistente'],
  approve_document: ['master', 'gerente', 'supervisora', 'supervisora_contabilidade'],
  sign_document: ['master', 'gerente', 'supervisora', 'supervisora_contabilidade'],
  manage_users: ['master'],
  manage_carteiras: ['master'],
  emit_document: ['master', 'emissor'],
};

/**
 * Verifica se o role do usuário pode acessar um path.
 * @param {string} userRole - role do usuário atual
 * @param {string} path - ex: '/aprovacoes' ou '/condominio/123/arrecadacoes'
 */
export function canAccessPath(userRole, path) {
  if (!userRole) return false;
  if (userRole === 'master') return true; // master sempre passa

  // Tenta casar com o prefixo mais específico primeiro
  const keys = Object.keys(ROUTE_ACCESS).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (path === key || path.startsWith(key + '/')) {
      return ROUTE_ACCESS[key].includes(userRole);
    }
  }
  return false;
}

/**
 * Verifica se o usuário tem uma capability (ação).
 * @param {string} userRole
 * @param {string} capability - ex: 'edit_planilha'
 */
export function can(userRole, capability) {
  if (!userRole || !CAPABILITIES[capability]) return false;
  return CAPABILITIES[capability].includes(userRole);
}

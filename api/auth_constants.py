"""
Constantes centralizadas de roles e permissões — espelho do frontend/src/lib/roles.js
Mantém o RBAC consistente entre back e front.
"""

# Roles disponiveis no sistema
ALL_ROLES = [
    'master', 'gerente', 'assistente', 'supervisora',
    'supervisora_contabilidade', 'supervisor_gerentes',
    'departamento', 'sindico', 'outros'
]

# Capabilities (espelho de CAPABILITIES no front)
EDIT_PLANILHA          = ['master', 'gerente']
EDIT_COBRANCAS_EXTRAS  = ['master', 'gerente', 'assistente']
APPROVE_DOCUMENT       = ['master', 'gerente', 'supervisora', 'supervisora_contabilidade', 'supervisor_gerentes']
SIGN_DOCUMENT          = APPROVE_DOCUMENT
MANAGE_USERS           = ['master']
EMIT_DOCUMENT          = ['master', 'departamento']
VIEW_PLANILHA          = ALL_ROLES[:-1]  # todos menos 'outros'
VIEW_AUDITORIA         = ['master', 'supervisora', 'supervisora_contabilidade', 'supervisor_gerentes', 'departamento']

# Pode filtrar dashboard por gerente_id (gestores e supervisores)
DASHBOARD_FILTER_GERENTE = ['master', 'supervisora', 'supervisora_contabilidade', 'supervisor_gerentes', 'departamento']

# Pode forçar pipeline status / aplicar a todos
PIPELINE_OVERRIDE = ['master']


def has_role(user: dict, roles: list) -> bool:
    """master sempre passa; caso contrário verifica lista."""
    r = (user or {}).get('role')
    if r == 'master':
        return True
    return r in roles

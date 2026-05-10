# Graph Report - C:/projetos/condominios  (2026-05-09)

## Corpus Check
- 125 files · ~126,023 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 368 nodes · 476 edges · 74 communities (50 shown, 24 thin omitted)
- Extraction: 90% EXTRACTED · 10% INFERRED · 0% AMBIGUOUS · INFERRED: 46 edges (avg confidence: 0.82)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Next.js Pages & Arrecadações|Next.js Pages & Arrecadações]]
- [[_COMMUNITY_FastAPI Legacy Routes (index.py)|FastAPI Legacy Routes (index.py)]]
- [[_COMMUNITY_Core Stack & Architecture Docs|Core Stack & Architecture Docs]]
- [[_COMMUNITY_API Routes Cobranças & Ações|API Routes: Cobranças & Ações]]
- [[_COMMUNITY_Cobranças Extras Endpoints|Cobranças Extras Endpoints]]
- [[_COMMUNITY_RBAC Patch Conferência & Assinaturas|RBAC Patch: Conferência & Assinaturas]]
- [[_COMMUNITY_Auth & Session Management|Auth & Session Management]]
- [[_COMMUNITY_Supabase Client Utilities|Supabase Client Utilities]]
- [[_COMMUNITY_Dashboard & Stats|Dashboard & Stats]]
- [[_COMMUNITY_Central de Emissões|Central de Emissões]]
- [[_COMMUNITY_Approval Flow (Aprovações)|Approval Flow (Aprovações)]]
- [[_COMMUNITY_Condomínio Pages|Condomínio Pages]]
- [[_COMMUNITY_User Admin|User Admin]]
- [[_COMMUNITY_Carteiras & Gerentes|Carteiras & Gerentes]]
- [[_COMMUNITY_Status Badge & UI Components|Status Badge & UI Components]]
- [[_COMMUNITY_Module Group 15|Module Group 15]]
- [[_COMMUNITY_Module Group 16|Module Group 16]]
- [[_COMMUNITY_Module Group 17|Module Group 17]]
- [[_COMMUNITY_Module Group 18|Module Group 18]]
- [[_COMMUNITY_Module Group 19|Module Group 19]]
- [[_COMMUNITY_Module Group 20|Module Group 20]]
- [[_COMMUNITY_Module Group 21|Module Group 21]]
- [[_COMMUNITY_Module Group 22|Module Group 22]]
- [[_COMMUNITY_Module Group 23|Module Group 23]]
- [[_COMMUNITY_Module Group 24|Module Group 24]]
- [[_COMMUNITY_Module Group 26|Module Group 26]]
- [[_COMMUNITY_Module Group 28|Module Group 28]]
- [[_COMMUNITY_Module Group 29|Module Group 29]]
- [[_COMMUNITY_Module Group 30|Module Group 30]]
- [[_COMMUNITY_Module Group 31|Module Group 31]]
- [[_COMMUNITY_Module Group 32|Module Group 32]]
- [[_COMMUNITY_Module Group 33|Module Group 33]]
- [[_COMMUNITY_Module Group 34|Module Group 34]]
- [[_COMMUNITY_Module Group 35|Module Group 35]]
- [[_COMMUNITY_Module Group 36|Module Group 36]]
- [[_COMMUNITY_Module Group 37|Module Group 37]]
- [[_COMMUNITY_Module Group 38|Module Group 38]]
- [[_COMMUNITY_Module Group 39|Module Group 39]]
- [[_COMMUNITY_Module Group 40|Module Group 40]]
- [[_COMMUNITY_Module Group 54|Module Group 54]]
- [[_COMMUNITY_Module Group 55|Module Group 55]]
- [[_COMMUNITY_Module Group 71|Module Group 71]]
- [[_COMMUNITY_Module Group 72|Module Group 72]]
- [[_COMMUNITY_Module Group 73|Module Group 73]]

## God Nodes (most connected - your core abstractions)
1. `cur_user()` - 25 edges
2. `set_flash()` - 21 edges
3. `get_db()` - 20 edges
4. `useToast()` - 20 edges
5. `useAuth()` - 19 edges
6. `tpl()` - 12 edges
7. `CondoFlow System` - 10 edges
8. `require_role()` - 8 edges
9. `arrecadacoes_view()` - 8 edges
10. `RBAC + ConferÃªncia Flow Plan` - 8 edges

## Surprising Connections (you probably didn't know these)
- `api_pendentes()` --calls--> `get_gerente_id()`  [INFERRED]
  _rbac_plan/api/api_routes_patch.py → api/api_routes.py
- `ModalLancar()` --calls--> `useToast()`  [INFERRED]
  patch_temp/frontend/src/app/carteiras/cobrancas/page.js → frontend/src/components/Toast.js
- `ModalCancelar()` --calls--> `useToast()`  [INFERRED]
  patch_temp/frontend/src/app/carteiras/cobrancas/page.js → frontend/src/components/Toast.js
- `CobrancasExtrasPage()` --calls--> `useAuth()`  [INFERRED]
  patch_temp/frontend/src/app/carteiras/cobrancas/page.js → frontend/src/lib/auth.js
- `CobrancasExtrasPage()` --calls--> `useToast()`  [INFERRED]
  patch_temp/frontend/src/app/carteiras/cobrancas/page.js → frontend/src/components/Toast.js

## Hyperedges (group relationships)
- **Core Tech Stack** — condoflow_stack_nextjs, condoflow_stack_supabase, condoflow_stack_fastapi [EXTRACTED 1.00]
- **All RBAC Roles** — rbac_role_master, rbac_role_gerente, rbac_role_assistente, rbac_role_supervisora, rbac_role_emissor [EXTRACTED 1.00]
- **Legacy Jinja2 Template Set** — template_base, template_dashboard, template_login, template_aprovacoes, template_arrecadacoes, template_carteiras, template_cobrancas, template_admin_usuarios [EXTRACTED 1.00]

## Communities (74 total, 24 thin omitted)

### Community 0 - "Next.js Pages & Arrecadações"
Cohesion: 0.05
Nodes (29): AprovacoesPage(), ArrecadacoesPage(), MESES, PLANOS, CentralEmissoesPage(), CobrancasPage(), FilaOcorrencias(), RouteGuard() (+21 more)

### Community 1 - "FastAPI Legacy Routes (index.py)"
Cohesion: 0.14
Nodes (39): adicionar_cobranca(), admin_condominios(), admin_usuarios(), api_plano_contas(), aprovacoes_page(), aprovar_processo(), arrecadacoes_view(), cached_query() (+31 more)

### Community 2 - "Core Stack & Architecture Docs"
Cohesion: 0.13
Nodes (16): Architecture Documentation, FastAPI Backend, Next.js 16 App Router, Supabase (Auth + PostgreSQL + Storage), CondoFlow System, NEXT_PUBLIC_API_URL (missing in Vercel = dashboard error), Multi-Level Approval Flow, Financial Spreadsheet (ArrecadaÃ§Ãµes) (+8 more)

### Community 3 - "API Routes: Cobranças & Ações"
Cohesion: 0.14
Nodes (15): api_cancelamentos_pendentes(), api_executar_cancelamento(), api_lancar_cobranca_extra(), api_processo_acao_v2(), api_solicitar_cancelamento(), api_vincular_assistente(), _mes_atual(), Vincula um assistente a um gerente (apenas master). (+7 more)

### Community 4 - "Cobranças Extras Endpoints"
Cohesion: 0.15
Nodes (14): api_cancelamentos_pendentes(), api_executar_cancelamento(), api_lancar_cobranca_extra(), api_listar_cobrancas(), api_solicitar_cancelamento(), CobrancaExtraSchema, ExecutarCancelamentoSchema, _mes_atual() (+6 more)

### Community 5 - "RBAC Patch: Conferência & Assinaturas"
Cohesion: 0.15
Nodes (14): api_assinaturas(), api_dados_conferencia(), api_pendentes(), api_processo_acao_v2(), api_vincular_assistente(), ApprovalActionV2, Aprova ou solicita correção de um processo.      - Solicitar correção: volta o p, Retorna documentos pendentes de ação do usuário atual.      - Aprovadores: veem (+6 more)

### Community 7 - "Supabase Client Utilities"
Cohesion: 0.15
Nodes (13): ApprovalActionV2, CobrancaExtraSchema, CondoData, CreateUserSchema, DesvincularCondoSchema, ExecutarCancelamentoSchema, ForceStatusSchema, RateioUpdate (+5 more)

### Community 8 - "Dashboard & Stats"
Cohesion: 0.44
Nodes (8): apiFetch(), CobrancasExtrasPage(), getMesAtual(), getToken(), isBloqueado(), MESES, ModalCancelar(), ModalLancar()

### Community 9 - "Central de Emissões"
Cohesion: 0.28
Nodes (5): AppShell(), ADMIN_ITEMS, NAV_ITEMS, ROLES_COM_BADGE, Sidebar()

### Community 10 - "Approval Flow (Aprovações)"
Cohesion: 0.22
Nodes (9): Table: assinaturas (digital signature), RBAC + ConferÃªncia Flow Plan, Role: Assistente, Role: Emissor (departamento), Role: Gerente, Role: Master (full access), Role: Supervisora, RouteGuard Component (+1 more)

### Community 11 - "Condomínio Pages"
Cohesion: 0.25
Nodes (6): { createClient }, envContent, fs, path, supabase, URL

### Community 12 - "User Admin"
Cohesion: 0.39
Nodes (6): can(), canAccessPath(), CAPABILITIES, ROLE_LABELS, ROLES, ROUTE_ACCESS

### Community 13 - "Carteiras & Gerentes"
Cohesion: 0.29
Nodes (5): condominios, envStr, envVars, [key, ...rest], supabase

### Community 14 - "Status Badge & UI Components"
Cohesion: 0.52
Nodes (6): apiDelete(), apiFetch(), apiFetcher(), apiPost(), apiPut(), getAuthHeaders()

### Community 15 - "Module Group 15"
Cohesion: 0.29
Nodes (7): Legacy Jinja2 Templates (replaced by Next.js), AprovaÃ§Ãµes Template (Legacy Jinja2), ArrecadaÃ§Ãµes Template (Legacy Jinja2), Base Jinja2 Template (Legacy), Carteiras Template (Legacy Jinja2), Dashboard Template (Legacy Jinja2), Login Template (Legacy Jinja2)

### Community 16 - "Module Group 16"
Cohesion: 0.33
Nodes (6): api_aprovacoes(), api_condominios(), api_dashboard(), api_pendentes(), get_gerente_id(), Retorna documentos pendentes de ação do usuário atual.      - Aprovadores: vee

### Community 17 - "Module Group 17"
Cohesion: 0.4
Nodes (3): env, fs, URL

### Community 18 - "Module Group 18"
Cohesion: 0.6
Nodes (3): config, proxy(), updateSession()

### Community 19 - "Module Group 19"
Cohesion: 0.6
Nodes (3): fmt(), formatCurrency(), VisualizadorConferencia()

### Community 20 - "Module Group 20"
Cohesion: 0.5
Nodes (3): c, files, fs

## Knowledge Gaps
- **98 isolated node(s):** `fs`, `env`, `URL`, `Cria o usuario master via REST API direta do Supabase (sem SDK)`, `fs` (+93 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **24 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `useAuth()` connect `Next.js Pages & Arrecadações` to `Dashboard & Stats`, `Central de Emissões`, `Module Group 22`?**
  _High betweenness centrality (0.025) - this node is a cross-community bridge._
- **Why does `useToast()` connect `Next.js Pages & Arrecadações` to `Dashboard & Stats`, `Module Group 19`?**
  _High betweenness centrality (0.024) - this node is a cross-community bridge._
- **Why does `get_gerente_id()` connect `Module Group 16` to `RBAC Patch: Conferência & Assinaturas`, `Auth & Session Management`?**
  _High betweenness centrality (0.010) - this node is a cross-community bridge._
- **Are the 19 inferred relationships involving `useToast()` (e.g. with `ModalCriarUsuario()` and `ModalCarteira()`) actually correct?**
  _`useToast()` has 19 INFERRED edges - model-reasoned connections that need verification._
- **Are the 18 inferred relationships involving `useAuth()` (e.g. with `UsuariosPage()` and `AprovacoesPage()`) actually correct?**
  _`useAuth()` has 18 INFERRED edges - model-reasoned connections that need verification._
- **What connects `fs`, `env`, `URL` to the rest of the system?**
  _98 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Next.js Pages & Arrecadações` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._
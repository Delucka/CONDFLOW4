# CondoFlow — Entrega RBAC + Fluxo de Conferência

Esta entrega implementa o plano de controle de acesso (RBAC) e o novo fluxo de
conferência com visualizador de PDF + planilha anual + cobranças extras lado a lado.

## Resumo das mudanças

### 1. Banco de dados (Supabase)
- Novos roles: `assistente` e `emissor`
- Novo campo `gerentes.assistente_id` (vínculo gerente ↔ assistente)
- Nova tabela `assinaturas` (assinatura digital com hash + timestamp)
- Novo campo `processos.emitido_por` (para rotear "solicitar correção")

### 2. Frontend
- `Sidebar.js` — filtra itens do menu conforme role do usuário
- `RouteGuard.js` — componente que bloqueia URL direta se role não permitir
- `VisualizadorConferencia.js` — split view: PDF à esquerda + planilha/cobranças à direita
- `roles.js` — fonte única de verdade de permissões (frontend)
- `usuarios/page.js` — gerencia usuários + carteiras (entrega anterior, mantida)

### 3. Backend (FastAPI)
- `GET /api/condominio/{id}/conferencia` — dados de apoio (planilha + cobranças)
- `POST /api/processo/{id}/acao` — aprovar/corrigir + assinatura digital
- `GET /api/pendentes` — pendentes do usuário atual (para dashboard)
- `GET /api/processo/{id}/assinaturas` — lista assinaturas de um processo
- `POST /api/gerentes/vincular-assistente` — vincular assistente a gerente

---

## Como aplicar

### Passo 1 — Rodar migração SQL no Supabase

Abra o SQL Editor do Supabase e cole o conteúdo de `sql/migration_rbac.sql`.
Execute uma vez. Ele é idempotente (pode rodar de novo sem quebrar).

> ⚠️ Os `ALTER TYPE ADD VALUE` precisam ser commitados ANTES de usar os novos
> valores. O Supabase faz commit implícito entre blocos `DO $$ ... $$`.

### Passo 2 — Atualizar backend

Copie todo o conteúdo de `api/api_routes_patch.py` e cole no FINAL do seu
arquivo `api/api_routes.py` atual. Não sobrescreva — só concatene.

### Passo 3 — Substituir arquivos do frontend

```
frontend/src/lib/roles.js                         ← NOVO
frontend/src/components/Sidebar.js                ← SUBSTITUI
frontend/src/components/RouteGuard.js             ← NOVO
frontend/src/components/VisualizadorConferencia.js ← NOVO
```

### Passo 4 — Proteger páginas sensíveis

Para cada rota que deve ser travada, envolva o `page.js` (ou crie um `layout.js`)
com o `RouteGuard`:

```jsx
// Exemplo: frontend/src/app/carteiras/layout.js
'use client';
import RouteGuard from '@/components/RouteGuard';

export default function CarteirasLayout({ children }) {
  return <RouteGuard>{children}</RouteGuard>;
}
```

Crie esse `layout.js` (ou similar) dentro de:
- `/carteiras` → só master
- `/carteiras/cobrancas` → master, gerente, assistente
- `/aprovacoes` → master, gerente, supervisora, sp. contabilidade
- `/central-emissoes` → master, gerente, emissor
- `/admin/usuarios` → só master

O `RouteGuard` lê o mapa `ROUTE_ACCESS` do `roles.js`, então normalmente
não precisa passar `allowedRoles` — ele descobre sozinho pela URL.

### Passo 5 — Integrar o Visualizador na Central de Emissões

Onde hoje o usuário clica num PDF para visualizar (na Central de Emissões,
Aprovações, etc.), chame o novo componente:

```jsx
import VisualizadorConferencia from '@/components/VisualizadorConferencia';

// no estado do page:
const [arquivoAberto, setArquivoAberto] = useState(null);

// ao clicar num arquivo:
setArquivoAberto({
  id: arquivo.id,
  nome: arquivo.nome,
  url: arquivo.url,              // URL pública/assinada do PDF
  processo_id: arquivo.processo_id,
  condominio_id: arquivo.condominio_id,
  emitido_por: arquivo.emitido_por
});

// e no JSX:
{arquivoAberto && (
  <VisualizadorConferencia
    arquivo={arquivoAberto}
    currentUser={user}
    onClose={() => setArquivoAberto(null)}
    onAction={() => { setArquivoAberto(null); recarregarLista(); }}
  />
)}
```

### Passo 6 — Testar

1. Crie um usuário com cada role (master, gerente, assistente, supervisora,
   supervisora_contabilidade, emissor).
2. Logue com cada um e confirme que o menu lateral só mostra os itens permitidos.
3. Tente acessar uma URL bloqueada digitando direto — o `RouteGuard` deve
   redirecionar pro dashboard com toast de erro.
4. Como gerente ou master, abra um documento: a planilha + cobranças devem
   aparecer ao lado direito. Teste "Aprovar e assinar" e "Solicitar correção".
5. Confirme no Supabase que a tabela `assinaturas` recebeu a linha com hash e
   timestamp, e que o processo rejeitado voltou com status
   `Solicitar alteração` e `issue_notes` preenchido.

---

## Matriz RBAC implementada

| Tela                  | Master | Gerente | Assistente | Supervisora | Sp. Contab. | Emissor |
|-----------------------|:------:|:-------:|:----------:|:-----------:|:-----------:|:-------:|
| Painel Central        | ✓      | ✓       | ✓          | ✓           | ✓           | ✓       |
| Planilha Anual        | ✓      | ✓       | leitura    | leitura     | leitura     | leitura |
| Carteiras             | ✓      | —       | —          | —           | —           | —       |
| Lançar Cobranças      | ✓      | ✓       | ✓          | —           | —           | —       |
| Aprovações            | ✓      | ✓       | —          | ✓           | ✓           | —       |
| Central de Emissões   | ✓      | ✓       | —          | —           | —           | ✓       |
| Acessos e Perfis      | ✓      | —       | —          | —           | —           | —       |

> A regra "leitura" da Planilha Anual é aplicada no componente de página dela —
> basta verificar `can(role, 'edit_planilha')` antes de renderizar os botões de
> editar / salvar.

---

## Próximos passos (não incluídos nesta entrega)

- Adicionar o quadro "Pendentes de aprovação" ao lado da tabela de condomínios
  no Dashboard (usando o endpoint `GET /api/pendentes` já criado).
- Aba dedicada no perfil do gerente para vincular seu assistente pelo modal de
  Acessos e Perfis.
- Validador automático que compara valores do documento com a planilha e marca
  linhas divergentes em vermelho (core já está no backend; só falta UI).

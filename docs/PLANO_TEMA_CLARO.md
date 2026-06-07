# 🎨 Plano — Migração para Tema Claro Profissional + Limpeza

> **Status**: EM ANDAMENTO. Iniciado 06/06/2026.
> **Objetivo**: migrar CondoFlow de tema escuro (slate-950/glassmorphism roxo+ciano) para **tema claro, clean e profissional**. Reduzir excesso de cores — destaque só onde importa. Eliminar código morto.

---

## 📊 Diagnóstico

- **Stack**: Next.js 16 (App Router) + Tailwind CSS v4 (`@theme` em `globals.css`) + React 19. Sem TypeScript.
- **Tema atual**: escuro. `--color-brand-bg: #030712`, glassmorphism (`backdrop-blur`), texto branco, **6+ cores de destaque** usadas com força em tudo (violet, cyan, emerald, amber, rose, pink, blue, orange, indigo).
- **Problema do usuário**: "muitas cores, chama atenção pra tudo". Falta hierarquia visual.
- **Magnitude**: ~673 ocorrências de classes escuras (`bg-slate-900`, `text-white`, `border-white/10`, etc) em **34 arquivos**.

### Arquivos por nº de ocorrências (prioridade de migração)
| Arquivo | Ocorrências |
|---|---|
| VisaoEmissor.js | 80 |
| consumos/page.js | 70 |
| VisaoMaster.js | 54 |
| arrecadacoes/page.js | 51 |
| aprovacoes/page.js | 40 |
| FilaOcorrencias.js | 36 |
| cobrancas/page.js (carteiras) | 38 |
| RegistroEmissoes.js | 35 |
| VisualizadorConferencia.js | 33 |
| admin/usuarios/page.js | 32 |
| condominios/page.js | 31 |
| VisaoGerente.js | 16 |
| ModalAlteracoesRateio.js | 15 |
| login, importar-gerentes, FilePreviewDrawer, etc | ~10 cada |
| dashboard, Sidebar, ModalSelecionarConta, modais menores | <12 |

---

## 🎨 Paleta nova (tema claro profissional)

Filosofia: **fundo neutro + texto escuro + cor SÓ em ação primária, status e alertas.**

### Tokens (definir em `globals.css @theme`)
```
/* Superfícies */
--surface-app:      #f5f6f8   /* fundo geral da página (slate-100-ish) */
--surface:          #ffffff   /* cards, painéis */
--surface-2:        #f8fafc   /* superfície sutil / hover de linha (slate-50) */
--surface-sunken:   #f1f5f9   /* áreas rebaixadas (slate-100) */

/* Texto */
--text-primary:     #0f172a   /* títulos, valores (slate-900) */
--text-secondary:   #475569   /* corpo (slate-600) */
--text-muted:       #94a3b8   /* labels, captions (slate-400) */

/* Bordas */
--border-subtle:    #e9edf2   /* divisórias finas */
--border:           #dfe4ea   /* bordas de card/input */
--border-strong:    #cbd5e1   /* bordas de destaque (slate-300) */

/* Brand — UM primário, usado com moderação */
--brand:            #6d28d9   /* violeta (identidade do logo) */
--brand-hover:      #5b21b6
--brand-soft:       #f3effe   /* fundo de chip/badge brand */
--brand-text:       #6d28d9

/* Semânticas (badges/alertas — fundo suave + texto forte) */
--success:#16a34a  --success-soft:#ecfdf5
--warning:#d97706  --warning-soft:#fffbeb
--danger: #dc2626  --danger-soft: #fef2f2
--info:   #2563eb  --info-soft:   #eff6ff

/* Elevação (sombras suaves, não glow) */
--shadow-sm: 0 1px 2px rgba(15,23,42,0.04), 0 1px 3px rgba(15,23,42,0.06)
--shadow-md: 0 2px 4px rgba(15,23,42,0.04), 0 4px 12px rgba(15,23,42,0.08)
```

### Regra de cores de destaque (reduzir o arco-íris)
- **Ação primária** (1 por tela): botão `--brand` sólido, texto branco.
- **Ação secundária**: fundo branco/neutro + borda + texto slate.
- **Status (badges)**: paleta semântica suave (fundo `*-soft`, texto/`*`). Manter as cores de status pois carregam significado, mas com fundo claro suave em vez de `/10` sobre preto.
- **Tabelas/cards/sidebar**: 100% neutros. Sem cor decorativa.
- **Ícones**: cinza por padrão; cor só quando comunicam estado.

---

## 🔧 Estratégia técnica (Tailwind v4)

Como o código usa classes hardcoded (não tokens), a migração é **classe→classe**, arquivo a arquivo, mas acelerada por:

1. **globals.css faz o trabalho pesado de base**: reescrever `.glass-panel`, `.glass-card`, `table/th/td`, `input/select/textarea`, scrollbar, body — tudo pra claro. Como esses são usados em massa, já clareia ~40% sem tocar componente.

2. **Mapa de substituição padrão** (aplicar com `Edit replace_all` por arquivo):
   | De (escuro) | Para (claro) |
   |---|---|
   | `bg-slate-950`, `bg-slate-900`, `bg-[#0a0a0f]`, `bg-[#0a0a0f]` | `bg-white` ou `bg-slate-50` |
   | `bg-slate-800` | `bg-slate-100` |
   | `text-white` | `text-slate-900` |
   | `text-gray-100`, `text-slate-200`, `text-gray-200` | `text-slate-800` |
   | `text-gray-400`, `text-slate-400`, `text-gray-500`, `text-slate-500` | `text-slate-500` |
   | `text-gray-600`, `text-slate-600` | `text-slate-400` |
   | `border-white/5`, `border-white/10` | `border-slate-200` |
   | `bg-white/5`, `bg-white/[0.02]`, `bg-white/[0.03]` | `bg-slate-50` |
   | `hover:bg-white/5`, `hover:bg-white/10` | `hover:bg-slate-100` |
   | `divide-white/5` | `divide-slate-200` |
   | `from-slate-950`, `via-slate-900`, `to-slate-950` (gradientes de fundo) | remover/`bg-slate-50` |
   | `placeholder-slate-600` | `placeholder-slate-400` |

3. **Cores de destaque** (`*-500/10` sobre escuro): trocar `/10` por `/10` ainda funciona em claro mas fica pálido. Preferir `bg-{cor}-50 text-{cor}-700 border-{cor}-200` para badges/chips. Avaliar caso a caso nos componentes de status.

4. **Remover efeitos de tema escuro**: `shadow-[0_0_15px_rgba(...)]` (glow neon) → `shadow-sm`/`shadow-md`. `backdrop-blur` pode ficar mas com fundo branco sólido.

---

## 📋 Ordem de execução (cada item = 1 commit)

| # | Escopo | Arquivos | Status |
|---|---|---|---|
| 1 | **Fundação**: globals.css (tokens + glass/table/input/scrollbar/body claros) | `globals.css` | ⬜ |
| 2 | **Chrome**: shell + navegação (aparece em todas as telas) | `AppShell.js`, `Sidebar.js` | ⬜ |
| 3 | **Componentes compartilhados** | `StatsCard.js`, `StatusBadge.js` (x2), `Toast.js`, `Skeleton.js`, `RouteGuard.js` | ⬜ |
| 4 | **Dashboard** | `dashboard/page.js` | ⬜ |
| 5 | **Consumos** | `consumos/page.js` | ⬜ |
| 6 | **Aprovações** | `aprovacoes/page.js` | ⬜ |
| 7 | **Central de Emissões** | `central-emissoes/page.js` + `VisaoEmissor`, `VisaoMaster`, `VisaoGerente`, `RegistroEmissoes`, `FilaOcorrencias` | ⬜ |
| 8 | **Visualizador + Modais** | `VisualizadorConferencia.js`, `ModalAlteracoesRateio.js`, `ModalSelecionarConta.js`, `ModalPreparacao.js`, `FilePreviewDrawer.js` | ⬜ |
| 9 | **Condomínios + Arrecadações + Cobranças** | `condominios/page.js`, `arrecadacoes/page.js`, `carteiras/cobrancas/page.js`, `condominio/[id]/cobrancas`, `condominio/[id]/emissoes` | ⬜ |
| 10 | **Telas auxiliares** | `login`, `alterar-senha`, `reset-password`, `admin/usuarios`, `admin/importar-gerentes`, `seed`, `error.js`, `not-found.js`, `page.js` | ⬜ |
| 11 | **Build + deploy + ajuste fino visual** | — | ⬜ |

---

## 🧹 Limpeza de código (achados)

> O código está **bem enxuto** — pouca coisa morta óbvia. Itens abaixo precisam de confirmação do usuário antes de remover.

| Item | Situação | Ação |
|---|---|---|
| `components/StatusBadge.js` vs `central-emissoes/components/StatusBadge.js` | 2 versões com **labels diferentes** ("Registrada" vs "Emissão registrada"). Não são duplicados idênticos. | ⚠️ Consolidar num só exige alinhar labels. Confirmar com usuário. Baixa prioridade. |
| `condominio/[id]/cobrancas/page.js` | Ainda linkado (dashboard, condominios) mas **redundante** com `/carteiras/cobrancas`. | ⚠️ Confirmar se ainda usa. Se não, remover página + links. |
| `condominio/[id]/emissoes/page.js` | Linkado em arrecadacoes como aba. Pode ser legado vs Central de Emissões. | ⚠️ Confirmar com usuário. |
| `app/seed/page.js` | Página de seed (dev-only). | ⚠️ Manter (útil) ou proteger só master. Já tem layout com guard. |
| `docs/PLANO_CONSUMOS_AUTO_EXTRACAO.md` | Plano já implementado (fases 1-5). | Manter como histórico. |

> **Nenhum componente em `/components` está órfão** — todos importados. `usePlanoContas`, `usePipelineConfig`, `useAlteracoesRateio` em uso.

---

## ⚠️ Para continuar em outra sessão

1. Ler este arquivo + `CLAUDE.md`
2. Ver o que já foi commitado: `git log --oneline | grep -i tema`
3. Continuar pela primeira linha `⬜` da tabela "Ordem de execução"
4. Build sempre da pasta `frontend`: `cd frontend && npm run build 2>&1 | tail -5`
5. **Deploy SEMPRE da raiz** `C:\projetos\condominios` (vercel.json + API Python lá): `npx vercel --prod --yes`
6. `.vercelignore` já configurado (não mexer no `/supabase/` com barra inicial)

### Comando de verificação de progresso da migração
```bash
# Conta ocorrências escuras restantes (deve cair a cada commit)
cd frontend && grep -rcE "bg-slate-9|text-white|border-white/" src --include=*.js | grep -v ":0" | sort -t: -k2 -rn
```

---

## 🎯 Decisões já tomadas (não reperguntar)
- Tema: claro, clean, profissional, fundo neutro + cor pontual.
- Brand primário único: violeta `#6d28d9` (mantém identidade do logo), usado com moderação.
- Status badges: manter cores semânticas mas em fundo suave (`*-50`/`*-700`).
- Sem glassmorphism pesado / sem glow neon no tema claro.
- Tabelas e sidebar: neutros, sem cor decorativa.

# Publicar o CondoFlow

Produção: **https://emissaonline.com** (projeto Vercel `condominios`).

Há dois caminhos. O manual é o de sempre e continua valendo; o workflow é para
não depender da sua máquina.

---

## Caminho 1 — manual (o de hoje)

```bash
cd frontend && npx vercel --prod --yes
```

`git push` sozinho **não** publica. Este é o único jeito hoje.

---

## Caminho 2 — pelo GitHub (Actions → "Publicar na Vercel" → Run workflow)

Gatilho manual, não automático: `git push` continua não publicando nada. Você
aperta o botão quando quiser.

Duas escolhas na hora de rodar:

| Campo | Valor | O que faz |
|---|---|---|
| `ambiente` | `previa` | URL temporária. **Não toca em produção.** Comece sempre por aqui. |
| | `producao` | Publica em emissaonline.com |
| `origem` | `frontend` | Espelha o comando manual acima |
| | `raiz` | Usa o `vercel.json` da raiz — publica o **FastAPI junto** |

### Antes da primeira vez: 3 segredos

Settings → Secrets and variables → Actions → New repository secret:

| Segredo | Onde achar |
|---|---|
| `VERCEL_TOKEN` | vercel.com/account/tokens → Create Token (escopo na conta/time do projeto) |
| `VERCEL_ORG_ID` | Projeto `condominios` → Settings → General → **Team ID** |
| `VERCEL_PROJECT_ID` | Mesma tela → **Project ID** |

Sem eles o workflow para no primeiro passo dizendo o que falta. Não chega a
tocar em produção.

---

## ⚠️ Resolver antes de usar `origem: raiz`

**Não sabemos o que o deploy de hoje realmente publica.** O `vercel.json` da raiz
declara dois builds:

```json
"builds": [
  { "src": "frontend/package.json", "use": "@vercel/next" },
  { "src": "api/index.py",          "use": "@vercel/python" }
]
```

Mas o comando manual roda de dentro de `frontend/`, onde esse arquivo **não se
aplica**. São artefatos diferentes: um sobe só o Next, o outro sobe Next + FastAPI.

Confira no painel: projeto `condominios` → Settings → General → **Root Directory**.

- Vazio (raiz) → hoje a API sobe junto → use `origem: raiz`
- `frontend` → hoje sobe só o front → use `origem: frontend` (o padrão)

Enquanto não confirmar, **fique no padrão `frontend`**, que é o que o comando
manual faz há tempo e o que está documentado no `CLAUDE.md`.

Confira também Settings → **Git**: se a integração com o repositório estiver
**ligada**, então `git push` já publica sozinho, o `CLAUDE.md` está desatualizado
e este workflow é redundante — nesse caso corrija o `CLAUDE.md` em vez de usar CI.

---

## Ordem recomendada na primeira vez

1. Cadastre os 3 segredos
2. Rode com `ambiente: previa`, `origem: frontend`
3. Abra a URL da prévia (sai no resumo da execução) e confira a tela
4. Só então rode de novo com `ambiente: producao`

O workflow roda `npm run build` antes de publicar, então código quebrado para no
CI e não chega na Vercel.

---

## Pendente de publicar (sessão de 04/08)

Commitado em `main-edh5y8`, **ainda não está no ar**:

- `49136b5` — fila de planilhas com nome do gerente e busca
- `3c606ac` — hook do graphify tolerante a ambiente sem a skill

## Pendente de rodar no banco (SQL Editor, não é deploy)

`1ac84ae` traz três migrations de RLS que **não foram aplicadas**:

1. `0080_rls_helpers.sql` — funções de apoio
2. `0081_rls_cobrancas_extras.sql` — testar a tela de cobranças depois
3. `0082_rls_processos.sql` — testar a planilha depois

Nessa ordem. Cada arquivo tem o rollback de uma linha no cabeçalho. Detalhes e
riscos em `docs/ESQUEMA-BANCO.md`, Armadilha 4.

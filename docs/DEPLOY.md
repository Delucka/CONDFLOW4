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
| `origem` | `raiz` | **Use este.** O `vercel.json` da raiz vale, e publica Next **+** FastAPI |
| | `frontend` | Só o Next — a API **não** sobe. Ver a seção abaixo antes de escolher |

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

## Publique da RAIZ, não de `frontend/`

Isto estava em aberto e foi **verificado** em 04/08/2026 com
`npx vercel project inspect condominios`:

```
Root Directory     .          <- raiz, não "frontend"
Framework Preset   Other
```

Como o Root Directory é a raiz, o `vercel.json` de lá **vale**, e ele declara
dois builds:

```json
"builds": [
  { "src": "frontend/package.json", "use": "@vercel/next" },
  { "src": "api/index.py",          "use": "@vercel/python" }
]
```

Ou seja: **publicar da raiz sobe o Next e o FastAPI juntos.** Publicar de dentro
de `frontend/` sobe só o front — e a API sai do ar, derrubando `/api/dashboard`,
`/api/condominios` e o resto.

O comando que está em produção hoje roda **da raiz**:

```bash
npx vercel --prod --yes      # na raiz do repositório
```

> O `CLAUDE.md` traz `cd frontend && npx vercel --prod --yes`. Com o Root
> Directory na raiz, esse comando publica um artefato **sem a API**. Prefira o
> comando acima até o `CLAUDE.md` ser corrigido.

**Integração Git:** desligada. O projeto não tem repositório conectado, e
commits empurrados não disparam publicação — confere com o que o `CLAUDE.md`
diz. O workflow do GitHub não é redundante.

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

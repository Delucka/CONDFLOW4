# Mover o Supabase para São Paulo

> **EXECUTADO em 07/09/2026.** O banco está em `sa-east-1` (São Paulo), projeto
> `condominios2` / `zdudjjlqltgbhehmhwfp`. O que segue é o registro do que foi
> feito, com os números medidos depois. O projeto antigo continua de pé como
> rede de segurança — apagar por volta de **22/09/2026**.

## O resultado

| | Oregon | São Paulo |
|---|---|---|
| 1 linha | 267 ms | **60 ms** |
| 325 linhas, 3 colunas (45 KB) | 270 ms | **69 ms** |
| 325 linhas, `select *` (238 KB) | 532 ms | **75 ms** |
| 3.588 `rateios_valores` (189 KB) | 456 ms | **73 ms** |
| preâmbulo do gerente, instância fria | 285 ms | **108 ms** |

Somando com o cache e o paralelismo das camadas 3 e 4, o preâmbulo saiu de
**1.665 ms para 108 ms — 15×**. E o tamanho do dado praticamente parou de
custar: 238 KB agora saem em 75 ms, contra 532 ms.

### Como foi

1. `pg_dump` nativo (17.11) pelo pooler, com os mesmos comandos que a CLI do
   Supabase gera — só que sem Docker. A CLI emite `--quote-all-identifier` no
   singular, que o `pg_dump` de verdade recusa; corrigido para o plural.
2. Restauração em **5,4 s, zero erros**, com `--single-transaction` e
   `ON_ERROR_STOP=1`.
3. Conferência: **69 tabelas e 15.650 linhas** dos dois lados, diferença de 2
   linhas em `auth.refresh_tokens` (sessões criadas durante o dump). Estrutura
   idêntica: 61 policies, 37 tabelas com RLS, 26 funções, 17 triggers, 136
   índices, 1 view, mesmas 6 extensões.
4. `pg_cron` recriado à mão (o schema `cron` não vem no dump).
5. Storage: **927 arquivos / 272,8 MB em 203 s**, zero falhas. Conferido:
   mesma contagem, **mesma soma exata de bytes** (286.066.905) e 30 arquivos
   sorteados idênticos por SHA-256.
6. Quatro variáveis trocadas na Vercel e deploy. O bundle do navegador passou a
   referenciar só o projeto novo.

O projeto novo usa as **chaves no formato novo** (`sb_publishable_` /
`sb_secret_`). Conferido antes de virar: `supabase-py` e `@supabase/ssr` 0.10.0
aceitam as duas, e nenhum código nosso decodifica a chave como JWT. O JWKS do
projeto novo também publica ES256, então o `JWT_LOCAL=1` continua valendo.

### Ainda pendente

- **Auth → URL Configuration** no projeto novo: `Site URL` e a lista de
  *Redirect URLs*. Não vêm no dump e não aparecem em `/auth/v1/settings`. É a
  armadilha que já mordeu este projeto uma vez (ver a nota sobre reset de senha).
- O `.env` da VPS ainda aponta para o projeto antigo. Nada usa hoje, mas fica
  errado se alguém voltar a usar.
- Apagar o projeto antigo por volta de 22/09 e **religar o spend cap**.

## O problema, em uma linha

O banco está em **us-west-2 (Oregon)**. Todo o resto do sistema está no Brasil.

| destino | RTT daqui |
|---|---|
| `sa-east-1` (São Paulo) | **4 ms** |
| VPS `api.emissaonline.com` | 6 ms |
| Vercel `emissaonline.com` | 10 ms |
| **o banco** (`db.<ref>.supabase.co`) | **185 ms** |
| `us-east-1` (Virgínia) | 124 ms |
| `us-west-2` (Oregon) | 186 ms |

### Como a região foi determinada

Sem acesso ao painel, por evidência pública e verificável:

1. `db.<ref>.supabase.co` resolve só em IPv6: `2600:1f13:838:6e58:...`
   (o host `<ref>.supabase.co` da API fica atrás da Cloudflare e não serve —
   o TCP dele termina no edge, a 9 ms, não na instância).
2. A AWS publica o mapa de prefixos em
   <https://ip-ranges.amazonaws.com/ip-ranges.json>. O prefixo que contém esse
   endereço é `2600:1f13::/36`, **região `us-west-2`**.
3. Confere com a medição: 185 ms do banco contra 186 ms do endpoint público de
   us-west-2.

Isso corrige duas coisas que estavam anotadas errado e que vinham guiando
decisão: que os ~180 ms eram *processamento* do Supabase (é distância), e que a
instância estaria em São Paulo (a função da Vercel foi movida para `gru1` por
causa dessa suposição).

## O que se ganha

O piso por ida ao banco sai de ~200 ms para ~25 ms. Tudo que a aplicação faz é
uma pilha de idas ao banco:

| | hoje | em SP |
|---|---|---|
| preâmbulo do `/api/dashboard` (gerente, cache frio) | 949 ms | ~110 ms |
| `/api/condominios` | 530 ms | ~70 ms |
| abrir a Central de Emissões | ~2,5 s | ~350 ms |

As otimizações de cache que já subiram (commit `80cbbbd`) escondem esse custo
enquanto o processo está quente. Elas continuam valendo depois da mudança — mas
deixam de ser o que separa "rápido" de "lento".

## O tamanho real do trabalho

O banco é pequeno. O que pesa é o Storage.

| | |
|---|---|
| linhas nas 17 tabelas principais | **9.225** |
| maior tabela (`aprovacoes`) | 1.094 linhas |
| `rateios_valores` | 3.588 linhas |
| bucket `emissoes` | **176 arquivos / 129,6 MB** só nos dois primeiros níveis; o total é maior (a varredura foi limitada) — confirmar no painel antes da janela |
| migrations versionadas | `supabase/migrations/*.sql` |

`pg_dump`/`pg_restore` de 9 mil linhas é questão de segundos. A cópia do bucket
é de minutos. **A janela é curta** — o risco não é duração, é esquecer de
repontar alguma coisa.

## O que aponta para o Supabase hoje

Levantado em 07/09/2026. Cada item precisa da URL e das chaves novas:

| onde | variáveis |
|---|---|
| Vercel (produção) | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` |
| VPS `/opt/condoflow/api/.env` | `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SERVICE_KEY` |
| n8n | credenciais dos fluxos que gravam no banco |
| `frontend/.env.local` | ambiente local (hoje já está sem as variáveis) |

Há coisas que **não** vêm no dump e precisam ser recriadas ou reconferidas do
outro lado: usuários do Auth (vêm no dump do schema `auth`, mas confirmar),
buckets e suas policies, `pg_net` e o hook de e-mail das notificações
(migrations 0048–0051), os `SECURITY DEFINER` de carteira
(`condominios_da_carteira`, `condominios_por_ausencia`), o trigger de lacre
(`protege_arquivos_lacrados`) e os agendamentos.

## Dois caminhos descartados (conferido em 07/09/2026)

**"Restore to a New Project" do painel NÃO serve.** É o caminho que a própria
Supabase recomenda para quem está em plano pago, copia a chave de criptografia
sozinho e replica tamanho de compute e disco — mas, da documentação, textualmente:

> "The data will remain **in the same region as the source project** to ensure
> compliance with data residency requirements."

Ele clona dentro de us-west-2. Serve para ambiente de teste, não para mudar de
região.

**`supabase db dump` exige Docker.** Testado na máquina: a CLI (2.117.0) roda
`pg_dump` dentro de um contêiner e falha com
`LegacyDockerRunError: docker: command not found (podman also not found)`.

Sobra o caminho manual com **`pg_dump` e `psql` nativos**, que não estão
instalados. São mais leves que o Docker Desktop e são a ferramenta certa para o
serviço — o que a CLI faz é montar a linha de comando do `pg_dump` (dá para ver
com `supabase db dump --dry-run`).

## Não dá para mudar a região no lugar

A região é escolhida quando o projeto nasce e não muda depois. A própria
documentação da Supabase manda **criar um projeto novo** e restaurar dentro
dele (*Platform → Upgrades & Migrations → Migrating within Supabase*). Por isso
existe, obrigatoriamente, um momento com duas instâncias de pé — e é só disso
que vem o custo extra.

Os comandos, da documentação (07/09/2026):

```bash
# no projeto ANTIGO
supabase db dump --db-url "$ANTIGO" -f roles.sql  --role-only
supabase db dump --db-url "$ANTIGO" -f schema.sql
supabase db dump --db-url "$ANTIGO" -f data.sql --use-copy --data-only \
  -x "storage.buckets_vectors" -x "storage.vector_indexes"

# histórico de migrations, senão o supabase/migrations perde o fio
supabase db dump --db-url "$ANTIGO" -f history_schema.sql --schema supabase_migrations
supabase db dump --db-url "$ANTIGO" -f history_data.sql --use-copy --data-only --schema supabase_migrations

# no projeto NOVO
psql --single-transaction --variable ON_ERROR_STOP=1 \
  --file roles.sql --file schema.sql \
  --command 'SET session_replication_role = replica' \
  --file data.sql --dbname "$NOVO"
```

Três coisas que os comandos **não** trazem e a documentação lista à parte:
extensões não-padrão precisam ser religadas no projeto novo, os *Database
Webhooks* também, e as *publications* do Realtime idem. O **Storage não entra
no dump** — os arquivos são cópia separada.

Existe ainda o fluxo **"Restore to a new project"** a partir de um backup, pelo
painel, que copia a chave de criptografia automaticamente (o dump manual não
copia). Conferir se ele deixa escolher a região: se deixar, é o caminho mais
curto e o mais seguro.

## Decisões que são suas, não minhas

1. **Custo.** O caminho normal é criar um projeto novo em `sa-east-1` e
   restaurar. Enquanto os dois existirem, são **dois projetos Pro**. Se der para
   fazer tudo numa janela e apagar o antigo no mesmo dia, a sobreposição é de
   horas; se quiser manter o antigo alguns dias como rede de segurança
   (recomendado), é mais um mês de Pro.
2. **A alternativa sem migrar:** *read replica* em `sa-east-1`. Leitura a 4 ms,
   escrita continua indo para Oregon. Menos risco, mas é add-on **pago por
   hora**, para sempre, e não conserta a escrita.
3. **A janela.** Precisa de um horário em que ninguém esteja emitindo.

## Roteiro (rascunho — revisar antes de executar)

1. Confirmar no painel: região atual, tamanho do banco, tamanho do Storage e o
   *compute tier* (se está em Nano, aproveitar a mudança).
2. Criar o projeto novo em `sa-east-1`. **Não apagar o antigo.**
3. `pg_dump` do antigo (schemas `public`, `auth`, `storage`) e `pg_restore` no
   novo. Conferir contagem de linhas tabela a tabela contra a lista acima.
4. Copiar o bucket `emissoes`, preservando os caminhos — `emissoes_arquivos`
   guarda o caminho, não o conteúdo, e um caminho diferente quebra todo anexo.
5. Recriar policies de bucket, `pg_net`, hook de e-mail e agendamentos.
6. Repontar Vercel → publicar → conferir `/api/health` e uma emissão real.
7. Repontar VPS e n8n.
8. Rodar a conferência: abrir uma emissão com anexos, baixar um PDF, gerar a
   Relação de Recibos, aprovar algo. São os quatro caminhos que tocam banco,
   Storage, RLS e API de uma vez.
9. Medir de novo o `carteira_condo_ids` frio. Se não cair para ~110 ms, algo
   ficou apontando para Oregon.
10. Só depois de um ciclo mensal inteiro, apagar o projeto antigo.

## Plano de volta

Enquanto o projeto antigo existir, voltar é repontar as mesmas variáveis para
ele. O que **não** volta é o que foi escrito no novo depois do corte — por isso
a janela precisa ser antes de um período de baixa escrita, e por isso o antigo
não se apaga no mesmo dia.

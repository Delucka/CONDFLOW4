# Mover o Supabase para São Paulo

> Levantamento e medições de **07/09/2026**. Nada aqui foi executado ainda —
> este é o documento que precisa existir **antes** da janela de manutenção.

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

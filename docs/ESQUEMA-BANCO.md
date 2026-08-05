# Esquema real do banco — e as armadilhas

> Escrito depois de uma sessão inteira perdida redescobrindo estas coisas.
> **Leia antes de escrever qualquer coluna, e antes de mexer em RLS.**
> O `applied.txt` ficou parado na 0051 por meses — não serve como fonte de
> verdade. Quem responde é o banco; as consultas estão no fim deste arquivo.

---

## `condominios` — o que existe de verdade

| Coluna | Veio de |
|---|---|
| `id`, `name`, `gerente_id`, `due_day` | 0001 |
| `plano_contas_id` | 0010 (integer) → 0021 (uuid, FK `planos_contas`) |
| `limit_gerencia`, `limit_emissao`, `limit_expedicao` | 0018 |
| `obs_emissao`, `obs_expedicao` | 0018 |
| `cnpj` | 0042 |
| `due_day_2` | 0054 |
| `caracteristicas` | 0056 |

**Removidas pela 0018:** `issue_limit_day`, `dispatch_limit_day`.

### Colunas fantasma — NÃO existem, apesar de o código as citar

- **`assistente`** — não existe em migration nenhuma. O vínculo real é
  `profiles.gerente_id` (0057). O `/condominios` devolve `assistente_nome`, derivado.
- **`fluxo`** — é coluna de **`processos`**, não de `condominios`.

Mandar qualquer uma delas no payload derruba a gravação inteira com
`PGRST204: Could not find the '<coluna>' column`.

---

## Armadilha 1 — escrita do cliente falha CALADA

`supabase-js` **devolve** `{ error }`, não lança. Isto aqui não avisa ninguém:

```js
await supabase.from('condominios').update({ fluxo: nivel }).eq('id', id);   // ❌
```

Três defeitos assim já foram encontrados em produção, todos gravando em coluna
inexistente por meses sem ninguém perceber. O último descartava silenciosamente o
nível de aprovação, e **todo processo era aprovado direto**, pulando os supervisores.

Sempre confira:

```js
const { error } = await supabase.from('x').update({...}).eq('id', id);
if (error) { addToast('...' + error.message, 'error'); return; }
```

**Corolário: código chamar uma coluna NÃO prova que ela existe.** Confira a migration.

---

## Armadilha 2 — `gerente_id` tem dois significados

- `condominios.gerente_id` → FK para **`gerentes.id`**
- `profiles.gerente_id` (0057) → id do **profile** do gerente (liga o assistente a ele)

O dropdown de gerente das telas é montado a partir de **profiles** (por isso mostra
`full_name`, campo de profiles). Mandar esse id direto para `condominios.gerente_id`
estoura `23503 foreign key constraint`. O backend normaliza em
`_resolver_gerente_id()` — aceita os dois e grava sempre `gerentes.id`.

---

## Armadilha 3 — dois status paralelos

| Fluxo | Tabela | Valores |
|---|---|---|
| Arrecadações (semestral) | `processos` | `Em edição`, `Enviado`, `Em aprovação`, `Aprovado`, `Solicitar alteração`, `Emitido` |
| Edição mensal | `edicoes_mensais` (0034) | `em_edicao`, `edicao_finalizada`, `reabertura_solicitada` |
| Emissões | `emissoes_pacotes` | `rascunho`, `pendente_gerente`, `pendente_sup_gerentes`, `pendente_sup_contabilidade`, `aprovado`, `registrado` |

`edicoes_mensais` é **por mês**: um condomínio tem uma linha por mês. Ler só a mais
recente e apresentá-la como "o status do condomínio" faz meses futuros já liberados
aparecerem no lugar do mês exibido. Sempre indexe por **condomínio + mês**.

---

## Armadilha 4 — política de RLS existir NÃO quer dizer que ela vale

`CREATE POLICY` numa tabela com RLS desligado é decorativo: o Postgres nem
consulta a política. Foi o que aconteceu com `processos` — a 0001 criou políticas
boas, a **0018 desligou o RLS** de sete tabelas, e a 0033 criou
`processos_all_authenticated` **sem reabilitar**. Ler a 0033 sozinha dá a impressão
de que a tabela está protegida; ela está aberta desde a 0018.

Desligadas pela 0018: `profiles`, `gerentes`, `condominios`, `processos`,
`arrecadacoes`, `cobrancas_extras`, `aprovacoes`. A 0073 religou os rateios; a 0081/0082,
`cobrancas_extras` e `processos`; a 0083/0084, `aprovacoes`, `arrecadacoes`,
`condominios` e `gerentes`. Só `profiles` (0085) fica de fora até ser aplicada.

**Nunca confie no `CREATE POLICY`. Confira o interruptor:**

```sql
SELECT relname, relrowsecurity FROM pg_class
 WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' AND NOT relrowsecurity;
```

Vale lembrar o que o RLS protege e o que não: o backend usa **service-role**, que
ignora RLS por definição. O RLS existe para o que o navegador faz **direto** no
Supabase com a chave `anon` — e várias telas escrevem assim.

Funções de apoio em `0080_rls_helpers.sql`: `papel_atual()` e
`condominios_da_carteira()`. Use-as em vez de repetir o JOIN da carteira, e
lembre que elas precisam ser `SECURITY DEFINER` — sem isso, uma política em
`profiles` que chame função que lê `profiles` entra em recursão infinita.

---

## Armadilha 5 — policy adormecida é armadilha carregada

Corolário da 4, e custou três tentativas para achar. Com o RLS **desligado**, uma
policy defeituosa fica inerte: nenhum teste a alcança, nenhum erro aparece. Ela
dispara no instante em que alguém liga o interruptor — possivelmente anos depois,
por outra pessoa, sem relação com quem a escreveu.

Foi o que aconteceu ao religar `profiles`. A 0001 havia criado:

```sql
-- "Master override all profiles"  (ALL)
EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'master')
-- "View profiles by all authenticated"  (SELECT)
(auth.uid() = id) OR EXISTS (SELECT 1 FROM profiles)
```

Duas policies **de `profiles` que consultam `profiles`**. Dormentes desde a 0018;
ao ligar o RLS, `42P17 infinite recursion detected`.

**Duas regras que saem daí:**

1. Ao religar RLS numa tabela, **apague TODAS as policies existentes primeiro** —
   lendo de `pg_policies`, nunca por nome adivinhado:

```sql
DO $limpa$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT policyname FROM pg_policies
            WHERE schemaname='public' AND tablename='<tabela>'
  LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.<tabela>', r.policyname);
  END LOOP;
END $limpa$;
```

2. **Uma policy nunca pode consultar a própria tabela.** Nem direto, nem por
   função. `SECURITY DEFINER` não resolveu na prática. Se a regra precisa do
   papel do usuário e o papel mora na tabela protegida, o caminho é liberar a
   leitura e fechar a **escrita** — foi o que a 0085 fez.

**RLS filtra LINHA, não COLUNA.** Deixar o usuário atualizar a própria linha em
`profiles` ainda permitiria `SET role='master'`. Para limitar coluna, é `GRANT`:

```sql
REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT  UPDATE (must_change_password, password_changed_at) ON public.profiles TO authenticated;
```

**Ensaie antes.** `BEGIN … RAISE EXCEPTION` aplica as policies, mede o que cada
papel enxergaria e desfaz — ver `ENSAIO_rls_*.sql`. Foi ele que pegou as duas
recursões sem tocar em produção.

---

## Dados pessoais (LGPD)

`condominos` (0071) guarda nome, CPF, telefone e e-mail de morador. A tabela tem
**RLS sem policy pública** — escrita só pelo backend com service-role. Nos endpoints
que a tocam, **não logue o payload**: só contagens.

---

## Como conferir de verdade

O `applied.txt` mente. Para saber se uma coluna existe:

```bash
grep -rn "ADD COLUMN.*<coluna>\|<coluna> \(text\|integer\|uuid\|boolean\)" supabase/migrations/*.sql
sed -n '/CREATE TABLE public.<tabela>/,/^);/p' supabase/migrations/0001_schema.sql
```

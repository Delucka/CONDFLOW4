-- ============================================================
-- ENSAIO das migrations 0080 → 0082 — NÃO É MIGRATION
-- ============================================================
-- Para que serve: rodar as três migrations de RLS de mentira, ver EXATAMENTE o
-- que cada papel passaria a enxergar e a poder escrever, e desfazer tudo. Nada
-- fica no banco. É o jeito de tirar o risco antes de aplicar de verdade.
--
-- Por que isso funciona: `BEGIN … ROLLBACK` cobre também DDL no Postgres —
-- CREATE POLICY, ALTER TABLE … ENABLE ROW LEVEL SECURITY e CREATE FUNCTION são
-- transacionais. Ao desfazer, o banco volta ao estado anterior, inclusive o
-- interruptor do RLS.
--
-- Como o teste imita um usuário logado: as políticas são `TO authenticated`, e
-- `auth.uid()` do Supabase lê `request.jwt.claims ->> 'sub'`. Definindo os dois
-- com SET LOCAL (que morre no ROLLBACK), a sessão passa a responder como aquele
-- usuário — mesmo caminho que o navegador percorre com a chave anon.
--
-- COMO USAR
--   1. Cole ESTE arquivo inteiro no SQL Editor do Supabase e execute.
--   2. Leia a saída (a última consulta traz o veredito).
--   3. NADA foi alterado — o ROLLBACK no fim garante.
--   4. Se os números fizerem sentido, aplique 0080, 0081 e 0082 de verdade.
--
-- O que este ensaio NÃO cobre: o comportamento da tela. Ele prova que as
-- políticas devolvem as linhas certas; não prova que o front usa as consultas
-- que você imagina. Depois de aplicar pra valer, teste cobranças e planilha.
-- ============================================================

BEGIN;

-- ══ 1. As três migrations, aplicadas DENTRO da transação ══
-- (coladas aqui automaticamente — é o conteúdo literal de 0080, 0081 e 0082)

-- ─────────── 0080_rls_helpers.sql ───────────
-- ============================================================
-- 0080 — Funções de apoio para as políticas de RLS
-- ============================================================
-- POR QUÊ: a 0073 (rateios) repetiu o mesmo JOIN de carteira quatro vezes, uma
-- vez por política. Cada tabela nova multiplicaria essa repetição — e um erro em
-- qualquer cópia abre um buraco silencioso. Aqui a regra fica escrita UMA vez.
--
-- SECURITY DEFINER é obrigatório, não conveniência: a política precisa ler
-- `profiles`, `gerentes` e `condominios`. Se um dia essas tabelas ganharem RLS,
-- uma função comum entraria em recursão infinita (a política de profiles
-- chamando a função que lê profiles). DEFINER quebra o ciclo.
--
-- `search_path` fixo em `public` fecha o vetor clássico de sequestro de schema
-- em função DEFINER.
--
-- ⚠️ ROLLBACK:
--   DROP FUNCTION IF EXISTS public.condominios_da_carteira();
--   DROP FUNCTION IF EXISTS public.papel_atual();
-- ============================================================

-- ── Papel do usuário logado ──
-- Devolve NULL para quem não tem profile (não deve acontecer, mas política
-- nenhuma pode explodir por isso — comparação com NULL simplesmente nega acesso).
CREATE OR REPLACE FUNCTION public.papel_atual()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.role::text FROM public.profiles p WHERE p.id = auth.uid();
$$;

-- ── Condomínios que o usuário logado pode tocar ──
-- Duas origens, conforme a 0057 documenta:
--   gerente    → a própria carteira        (gerentes.profile_id → gerentes.id → condominios.gerente_id)
--   assistente → a carteira do SEU gerente (profiles.gerente_id guarda o PROFILE do gerente,
--                não o gerentes.id — é a Armadilha 2 do docs/ESQUEMA-BANCO.md)
-- Para os demais papéis devolve vazio; quem tem alcance global é tratado por
-- papel na política, não por esta função.
CREATE OR REPLACE FUNCTION public.condominios_da_carteira()
RETURNS TABLE (condominio_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id
    FROM public.condominios c
    JOIN public.gerentes    g ON c.gerente_id = g.id
   WHERE g.profile_id = auth.uid()
  UNION
  SELECT c.id
    FROM public.condominios c
    JOIN public.gerentes    g ON c.gerente_id = g.id
    JOIN public.profiles    p ON p.gerente_id = g.profile_id
   WHERE p.id = auth.uid() AND p.role::text = 'assistente';
$$;

REVOKE ALL ON FUNCTION public.papel_atual()              FROM PUBLIC;
REVOKE ALL ON FUNCTION public.condominios_da_carteira()  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.papel_atual()             TO authenticated;
GRANT EXECUTE ON FUNCTION public.condominios_da_carteira() TO authenticated;

-- ── Conferência ──
-- Logado como um gerente, deve listar só a carteira dele:
--   SELECT public.papel_atual();
--   SELECT count(*) FROM public.condominios_da_carteira();


-- ─────────── 0081_rls_cobrancas_extras.sql ───────────
-- ============================================================
-- 0081 — Religa RLS em cobrancas_extras
-- ============================================================
-- POR QUÊ: é o buraco mais grave achado na auditoria, pior que o dos rateios.
--
--   1. A 0003 criou a tabela com RLS ligado, mas com `USING (true)` — aberto.
--   2. A 0018 DESLIGOU o RLS de vez. Desde então a política nem é consultada.
--   3. A tela `/condominio/[id]/cobrancas` escreve DIRETO pela chave pública:
--      insert em page.js:73 e **delete** em page.js:98.
--   4. O `canEdit` daquela página (page.js:63) NÃO checa papel nenhum além de
--      master — basta o período estar ativo. Ou seja, qualquer papel que alcança
--      a rota `/condominio` (master, gerente, assistente, supervisora,
--      supervisora_contabilidade, departamento) consegue inserir e APAGAR
--      cobrança de QUALQUER condomínio, via DevTools ou pela própria tela.
--
-- Delete de cobrança é irreversível e mexe em dinheiro que vai para o boleto.
--
-- MODELO (derivado de auth_constants.py, não inventado):
--   leitura  — master, departamento e os três supervisores veem tudo; eles
--              revisam a emissão inteira (VisualizadorConferencia é usado em
--              /aprovacoes, que os supervisores acessam). Gerente e assistente:
--              só a carteira.
--   escrita  — EDIT_COBRANCAS_EXTRAS = master, gerente, assistente. Somando
--              `departamento`, que edita pela Central de Emissões. Supervisor
--              NÃO escreve: ele aprova pelos endpoints do backend, que usam
--              service-role e ignoram o RLS.
--
-- O backend (service-role) não é afetado por nada disto.
--
-- ⚠️ ROLLBACK IMEDIATO (se a tela de cobranças parar de salvar):
--   ALTER TABLE public.cobrancas_extras DISABLE ROW LEVEL SECURITY;
-- ============================================================

-- ── Limpa o que existe (idempotente) ──
DROP POLICY IF EXISTS "allow_all_cobrancas"            ON public.cobrancas_extras;
DROP POLICY IF EXISTS "cobrancas_extras_leitura"       ON public.cobrancas_extras;
DROP POLICY IF EXISTS "cobrancas_extras_escrita"       ON public.cobrancas_extras;

ALTER TABLE public.cobrancas_extras ENABLE ROW LEVEL SECURITY;

-- ══════════════ Leitura ══════════════
CREATE POLICY "cobrancas_extras_leitura" ON public.cobrancas_extras
  FOR SELECT TO authenticated
  USING (
    public.papel_atual() IN (
      'master', 'departamento',
      'supervisora', 'supervisora_contabilidade', 'supervisor_gerentes'
    )
    OR condominio_id IN (SELECT condominio_id FROM public.condominios_da_carteira())
  );

-- ══════════════ Escrita (insert / update / delete) ══════════════
-- FOR ALL cobre os três; a leitura acima é permissiva o bastante para não ser
-- estreitada por esta, porque políticas do mesmo comando se somam (OR).
CREATE POLICY "cobrancas_extras_escrita" ON public.cobrancas_extras
  FOR ALL TO authenticated
  USING (
    public.papel_atual() IN ('master', 'departamento')
    OR (
      public.papel_atual() IN ('gerente', 'assistente')
      AND condominio_id IN (SELECT condominio_id FROM public.condominios_da_carteira())
    )
  )
  WITH CHECK (
    public.papel_atual() IN ('master', 'departamento')
    OR (
      public.papel_atual() IN ('gerente', 'assistente')
      AND condominio_id IN (SELECT condominio_id FROM public.condominios_da_carteira())
    )
  );

-- ── Conferência ──
-- SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'cobrancas_extras';
-- SELECT policyname, cmd FROM pg_policies WHERE tablename = 'cobrancas_extras';
--
-- Teste que importa, logado como GERENTE (chave anon, não service):
--   SELECT count(*) FROM cobrancas_extras;                  -- só a carteira dele
--   DELETE FROM cobrancas_extras WHERE id = '<de outro condomínio>';  -- 0 linhas


-- ─────────── 0082_rls_processos.sql ───────────
-- ============================================================
-- 0082 — Religa RLS em processos
-- ============================================================
-- POR QUÊ: `processos` ficou de fora da lista original da auditoria, mas a MESMA
-- tela da planilha escreve nele pela chave pública — fechar só os rateios deixa a
-- tela metade blindada.
--
--   arrecadacoes/page.js:457 → update issue_notes
--   arrecadacoes/page.js:497 → update do NÍVEL DE APROVAÇÃO
--
-- A segunda é a que pesa: foi exatamente o campo que, quando gravava errado,
-- fazia todo processo ser aprovado direto pulando os supervisores (eb26fb9).
-- Deixá-lo escrevível por qualquer usuário logado anula a trilha de aprovação.
--
-- ESTADO ATUAL: a 0001 criou políticas boas; a 0018 DESLIGOU o RLS; a 0033 criou
-- `processos_all_authenticated` com `USING (true)` mas **nunca reabilitou o RLS**.
-- Resultado: as políticas existem e são inertes, e a tabela está aberta.
--
-- MODELO: igual ao da 0081, pelos mesmos motivos e pela mesma fonte
-- (auth_constants.py). Diferença de escrita: EDIT_PLANILHA = master + gerente
-- apenas — assistente NÃO edita planilha (canEdit em arrecadacoes/page.js:278
-- confirma). `departamento` entra porque a Central de Emissões grava
-- issue_notes/status pelo VisaoEmissor.
--
-- ⚠️ ROLLBACK IMEDIATO (se a planilha parar de salvar):
--   ALTER TABLE public.processos DISABLE ROW LEVEL SECURITY;
-- ============================================================

-- ── Limpa o que existe (idempotente) ──
DROP POLICY IF EXISTS "processos_all_authenticated"                                  ON public.processos;
DROP POLICY IF EXISTS "Allow all auth users"                                         ON public.processos;
DROP POLICY IF EXISTS "Master vê todos processos"                                    ON public.processos;
DROP POLICY IF EXISTS "Gerente enxerga e edita os processos (limitado ao status pelo BD)" ON public.processos;
DROP POLICY IF EXISTS "Gerente edita processo SÓ SE status for Em Edição"            ON public.processos;
DROP POLICY IF EXISTS "processos_leitura"                                            ON public.processos;
DROP POLICY IF EXISTS "processos_escrita"                                            ON public.processos;

ALTER TABLE public.processos ENABLE ROW LEVEL SECURITY;

-- ══════════════ Leitura ══════════════
CREATE POLICY "processos_leitura" ON public.processos
  FOR SELECT TO authenticated
  USING (
    public.papel_atual() IN (
      'master', 'departamento',
      'supervisora', 'supervisora_contabilidade', 'supervisor_gerentes'
    )
    OR condominio_id IN (SELECT condominio_id FROM public.condominios_da_carteira())
  );

-- ══════════════ Escrita ══════════════
-- Sem assistente: EDIT_PLANILHA = master + gerente.
CREATE POLICY "processos_escrita" ON public.processos
  FOR ALL TO authenticated
  USING (
    public.papel_atual() IN ('master', 'departamento')
    OR (
      public.papel_atual() = 'gerente'
      AND condominio_id IN (SELECT condominio_id FROM public.condominios_da_carteira())
    )
  )
  WITH CHECK (
    public.papel_atual() IN ('master', 'departamento')
    OR (
      public.papel_atual() = 'gerente'
      AND condominio_id IN (SELECT condominio_id FROM public.condominios_da_carteira())
    )
  );

-- ── Conferência ──
-- SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'processos';
-- SELECT policyname, cmd FROM pg_policies WHERE tablename = 'processos';
--
-- Teste que importa, logado como ASSISTENTE (chave anon):
--   SELECT count(*) FROM processos;   -- vê a carteira do gerente dele
--   UPDATE processos SET fluxo = 1 WHERE id = '<qualquer>';   -- 0 linhas


-- ══ 2. Cobaias, totais de referência e placar ══
-- Tabelas NORMAIS, não TEMP. O SQL Editor do Supabase não manteve as temporárias
-- entre os comandos ("relation _cobaias does not exist"); como tudo aqui termina
-- em ROLLBACK, tabela comum some do mesmo jeito e sem essa esquisitice de escopo.
DROP TABLE IF EXISTS _ensaio_cobaias, _ensaio_antes, _ensaio_resultado;

CREATE TABLE _ensaio_cobaias AS
SELECT 'gerente'::text AS papel, p.id, p.full_name
  FROM public.profiles p
  JOIN public.gerentes g ON g.profile_id = p.id
 WHERE p.role::text = 'gerente'
   AND EXISTS (SELECT 1 FROM public.condominios c WHERE c.gerente_id = g.id)
 LIMIT 1;

INSERT INTO _ensaio_cobaias
SELECT 'assistente', p.id, p.full_name
  FROM public.profiles p
 WHERE p.role::text = 'assistente' AND p.gerente_id IS NOT NULL
 LIMIT 1;

INSERT INTO _ensaio_cobaias
SELECT 'master', p.id, p.full_name
  FROM public.profiles p WHERE p.role::text = 'master' LIMIT 1;

CREATE TABLE _ensaio_antes AS
SELECT (SELECT count(*) FROM public.condominios)      AS condominios,
       (SELECT count(*) FROM public.cobrancas_extras) AS cobrancas,
       (SELECT count(*) FROM public.processos)        AS processos;

-- ══ 3. Mede o que cada papel enxergaria ══
CREATE TABLE _ensaio_resultado (papel text, quem text, cobrancas bigint, processos bigint, carteira bigint);

-- CRÍTICO: o DONO da tabela ignora RLS por definição no Postgres. No SQL Editor
-- você roda como superusuário/dono, então SEM trocar para `authenticated` tudo
-- pareceria liberado e este ensaio daria um falso "está tudo bem".
-- Por isso: troca de papel de verdade + a claim que o auth.uid() lê.
DO $$
DECLARE
  c RECORD;
  n_cob bigint; n_proc bigint; n_cart bigint;
  papel_original text := current_user;   -- pode ser postgres, supabase_admin…
BEGIN
  FOR c IN SELECT * FROM _ensaio_cobaias LOOP
    PERFORM set_config('request.jwt.claims',
                       json_build_object('sub', c.id, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';

    SELECT count(*) INTO n_cob  FROM public.cobrancas_extras;
    SELECT count(*) INTO n_proc FROM public.processos;
    SELECT count(*) INTO n_cart FROM public.condominios_da_carteira();

    EXECUTE format('SET LOCAL ROLE %I', papel_original);
    INSERT INTO _ensaio_resultado VALUES (c.papel, c.full_name, n_cob, n_proc, n_cart);
  END LOOP;

  PERFORM set_config('request.jwt.claims', '', true);
EXCEPTION WHEN OTHERS THEN
  -- A falha vai para a TABELA, não só para NOTICE: o editor do Supabase pode não
  -- mostrar notices, e você veria "0 linhas" achando que não há nada a ver, em
  -- vez de "o teste não rodou".
  EXECUTE format('SET LOCAL ROLE %I', papel_original);
  INSERT INTO _ensaio_resultado
    VALUES ('ERRO', 'não consegui imitar o usuário: ' || SQLERRM, -1, -1, -1);
END $$;

-- ══ 4. VEREDITO ══
-- Precisa ser a ÚLTIMA consulta que devolve linhas: o editor do Supabase mostra
-- só o último resultado. Por isso a checagem do interruptor virou uma linha
-- daqui, em vez de um SELECT separado no fim.
--
-- Leia assim:
--   master      → vê TUDO (o mesmo total de "de N")
--   gerente     → vê MENOS que o total, e mais que zero
--   assistente  → idem (a carteira do gerente dele)
--   ZERO em gerente/assistente = política estreita demais; a tela para de
--   salvar. NÃO aplique nesse caso — me mande esta saída.
SELECT ordem, papel, quem, condominios_da_carteira, cobrancas_visiveis, processos_visiveis, veredito
FROM (
  -- Interruptor: prova que o RLS ficaria LIGADO nas duas tabelas
  SELECT 0 AS ordem,
         'RLS' AS papel,
         string_agg(relname || '=' || relrowsecurity::text, '  ') AS quem,
         NULL::bigint AS condominios_da_carteira,
         NULL::text AS cobrancas_visiveis,
         NULL::text AS processos_visiveis,
         CASE WHEN bool_and(relrowsecurity) THEN 'OK — ligado nas duas'
              ELSE 'ATENÇÃO — não ligou' END AS veredito
    FROM pg_class
   WHERE relnamespace = 'public'::regnamespace
     AND relname IN ('cobrancas_extras', 'processos')

  UNION ALL

  SELECT CASE r.papel WHEN 'master' THEN 1 WHEN 'gerente' THEN 2 WHEN 'ERRO' THEN 9 ELSE 3 END,
         r.papel,
         r.quem,
         r.carteira,
         r.cobrancas || ' de ' || a.cobrancas,
         r.processos || ' de ' || a.processos,
         CASE
           WHEN r.papel = 'ERRO'                                          THEN 'FALHOU — não confie neste ensaio'
           WHEN r.papel = 'master'
                AND r.cobrancas = a.cobrancas AND r.processos = a.processos THEN 'OK — vê tudo'
           WHEN r.papel <> 'master' AND r.carteira = 0                     THEN 'ATENÇÃO — carteira vazia; confira o vínculo'
           WHEN r.papel <> 'master' AND r.cobrancas = 0 AND a.cobrancas > 0 THEN 'SUSPEITO — não vê nenhuma cobrança'
           WHEN r.papel <> 'master' AND r.processos = 0 AND a.processos > 0 THEN 'SUSPEITO — não vê nenhum processo'
           ELSE 'OK'
         END
    FROM _ensaio_resultado r CROSS JOIN _ensaio_antes a

  UNION ALL

  -- Rede de segurança: sem nenhuma cobaia, o resultado sairia vazio e pareceria
  -- "nada a ver" em vez de "o teste não rodou".
  SELECT 8, 'SEM COBAIA',
         'não achei gerente/assistente/master para testar', NULL, NULL, NULL,
         'INCONCLUSIVO — confira os vínculos em profiles/gerentes'
   WHERE NOT EXISTS (SELECT 1 FROM _ensaio_resultado)
) v
ORDER BY ordem;

-- ══ 5. DESFAZ TUDO ══
-- Nada acima persiste: políticas, funções e o RLS voltam como estavam.
ROLLBACK;

-- Conferência pós-ensaio (rode depois, fora da transação):
--   SELECT relname, relrowsecurity FROM pg_class
--    WHERE relnamespace='public'::regnamespace AND relname IN ('cobrancas_extras','processos');
--   Deve mostrar `false` nas duas — prova de que o ensaio não deixou rastro.

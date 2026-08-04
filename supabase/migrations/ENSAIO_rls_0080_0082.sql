-- ============================================================
-- ENSAIO das migrations 0080 → 0082 — NÃO É MIGRATION
-- ============================================================
-- Aplica as três de mentira, mostra o que cada papel passaria a enxergar, e
-- DESFAZ TUDO. Nada fica gravado.
--
-- ⚠️ O RESULTADO VEM COMO "ERROR" EM VERMELHO. Isso é proposital: o bloco
--    termina com RAISE EXCEPTION, que aborta a transação e por isso garante o
--    desfazer. A mensagem do erro É o relatório. Leia o texto.
--
-- Por que assim: o SQL Editor do Supabase não mantém tabelas criadas entre os
-- comandos de uma mesma execução (foi o "relation _ensaio_cobaias does not
-- exist"). Aqui não se cria tabela nenhuma — a medição inteira acontece dentro
-- de um único bloco, em variáveis.
--
-- COMO USAR: cole tudo, execute, leia a mensagem vermelha.
-- ============================================================

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

-- ══ Medição — tudo num bloco só, sem criar tabelas ══
DO $ensaio$
DECLARE
  c              RECORD;
  papel_original text := current_user;
  tot_cob        bigint;
  tot_proc       bigint;
  n_cob          bigint;
  n_proc         bigint;
  n_cart         bigint;
  rls_cob        boolean;
  rls_proc       boolean;
  linhas         text := '';
  parecer        text;
  achou          boolean := false;
BEGIN
  SELECT relrowsecurity INTO rls_cob  FROM pg_class
   WHERE relnamespace='public'::regnamespace AND relname='cobrancas_extras';
  SELECT relrowsecurity INTO rls_proc FROM pg_class
   WHERE relnamespace='public'::regnamespace AND relname='processos';

  SELECT count(*) INTO tot_cob  FROM public.cobrancas_extras;
  SELECT count(*) INTO tot_proc FROM public.processos;

  linhas := format(E'RLS ligado?  cobrancas_extras=%s  processos=%s\n', rls_cob, rls_proc)
         || format(E'Total no banco (sem RLS):  %s cobranças  ·  %s processos\n', tot_cob, tot_proc)
         || E'\n  PAPEL       QUEM                            CARTEIRA  COBRANÇAS  PROCESSOS  VEREDITO\n';

  -- CRÍTICO: o dono da tabela IGNORA RLS. Sem virar `authenticated` de verdade,
  -- tudo pareceria liberado e este ensaio daria um falso "está tudo bem".
  FOR c IN
      SELECT 'master'::text AS papel, p.id, p.full_name FROM public.profiles p
       WHERE p.role::text='master' LIMIT 1
    UNION ALL
      SELECT 'gerente', p.id, p.full_name
        FROM public.profiles p JOIN public.gerentes g ON g.profile_id=p.id
       WHERE p.role::text='gerente'
         AND EXISTS (SELECT 1 FROM public.condominios x WHERE x.gerente_id=g.id) LIMIT 1
    UNION ALL
      SELECT 'assistente', p.id, p.full_name FROM public.profiles p
       WHERE p.role::text='assistente' AND p.gerente_id IS NOT NULL LIMIT 1
  LOOP
    achou := true;
    PERFORM set_config('request.jwt.claims',
                       json_build_object('sub', c.id, 'role','authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';

    SELECT count(*) INTO n_cob  FROM public.cobrancas_extras;
    SELECT count(*) INTO n_proc FROM public.processos;
    SELECT count(*) INTO n_cart FROM public.condominios_da_carteira();

    EXECUTE format('SET LOCAL ROLE %I', papel_original);

    parecer := CASE
      WHEN c.papel='master' AND n_cob=tot_cob AND n_proc=tot_proc THEN 'OK - ve tudo'
      WHEN c.papel='master'                                        THEN 'ATENCAO - master nao ve tudo'
      WHEN n_cart=0                                                THEN 'ATENCAO - carteira vazia'
      WHEN n_cob=0  AND tot_cob>0                                  THEN 'SUSPEITO - nenhuma cobranca'
      WHEN n_proc=0 AND tot_proc>0                                 THEN 'SUSPEITO - nenhum processo'
      ELSE 'OK'
    END;

    linhas := linhas || format(E'  %-11s %-31s %8s  %4s/%-4s  %4s/%-4s  %s\n',
                               c.papel, left(coalesce(c.full_name,'(sem nome)'),31),
                               n_cart, n_cob, tot_cob, n_proc, tot_proc, parecer);
  END LOOP;

  IF NOT achou THEN
    linhas := linhas || E'  INCONCLUSIVO - nao achei master/gerente/assistente para testar.\n';
  END IF;

  RAISE EXCEPTION E'\n=== VEREDITO DO ENSAIO (nada foi gravado) ===\n%\nSe tudo OK, aplique 0080, 0081 e 0082 de verdade.', linhas;
END
$ensaio$;

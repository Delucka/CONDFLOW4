-- ============================================================
-- 0098 — `condominio_grupos` volta a ser visível pelo navegador
-- ============================================================
-- ISTO É CONSERTO DE BUG, NÃO SÓ ENDURECIMENTO.
--
-- A 0086 criou a tabela e ligou o RLS sem criar policy nenhuma. RLS ligado sem
-- policy = ninguém acessa pela chave anon. Conferido em 16/08/2026:
--
--   set local role authenticated; select count(*) from condominio_grupos;  -- 0
--
-- O backend não sente, porque usa service-role e passa por cima do RLS. Por
-- isso a planilha e a conferência mostram grupo normalmente. Mas TODA tela que
-- lê a tabela direto do navegador recebe lista vazia, sem erro:
--
--   * VisaoEmissor: o seletor de vencimento fica vazio e a emissão nasce sem
--     `grupo_id` — a separação por grupo simplesmente não acontece
--   * conjuntoEmissao.anexarGrupos(): sem nome de grupo, o selo some das listas
--     do gerente e do master
--   * Expedição: a coluna de vencimento cai no `due_day` do condomínio, então
--     condomínio de dois vencimentos aparece com um só
--
-- É a explicação de "a separação por grupo não aparece na emissão". Não era a
-- tela: era o banco devolvendo vazio calado.
--
-- ── O desenho ──
-- LEITURA: qualquer usuário logado. O grupo é nome + dia de vencimento; não tem
-- dado de morador nem de dinheiro. Fechar por carteira aqui traria o mesmo risco
-- de recursão da 0084 sem proteger nada que importe.
--
-- ESCRITA: master e departamento. Quem cria e renomeia grupo é a tela de
-- arrecadações, e o formulário é deles.
--
-- ⚠️ ROLLBACK IMEDIATO (volta ao estado de hoje):
--   DROP POLICY IF EXISTS "grupos_leitura" ON public.condominio_grupos;
--   DROP POLICY IF EXISTS "grupos_escrita" ON public.condominio_grupos;
-- ============================================================

-- Sem adivinhar nome: se sobrou alguma policy de tentativa anterior, sai antes.
DO $limpa$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT policyname FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'condominio_grupos'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.condominio_grupos', r.policyname);
  END LOOP;
END $limpa$;

ALTER TABLE public.condominio_grupos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "grupos_leitura" ON public.condominio_grupos
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "grupos_escrita" ON public.condominio_grupos
  FOR ALL TO authenticated
  USING      (public.papel_atual() IN ('master', 'departamento'))
  WITH CHECK (public.papel_atual() IN ('master', 'departamento'));

-- ── Conferência ──
-- 1) O mesmo teste que provou o problema, agora tem de devolver o número real:
--
--      set local role authenticated;
--      select count(*) as grupos_visiveis from public.condominio_grupos;
--
-- 2) Na tela, com o usuário de emissão:
--    Central de Emissões → Fazer Emissões → escolher um condomínio de DOIS
--    vencimentos. O seletor de grupo tem de listar os dois.
--    Expedição: a coluna de vencimento passa a mostrar o dia do GRUPO.

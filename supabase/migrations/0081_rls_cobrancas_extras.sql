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

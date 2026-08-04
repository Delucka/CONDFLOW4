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

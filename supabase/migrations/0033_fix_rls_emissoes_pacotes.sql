-- ==========================================
-- MIGRATION: Fix RLS em emissoes_pacotes (e tabelas relacionadas)
-- Causa: policy original com FOR ALL + apenas USING bloqueava
-- UPDATEs silenciosamente em alguns casos (gerente aprovando pacote).
-- Solucao: redeclarar policies com TO authenticated + USING + WITH CHECK
-- explicitos. RLS controla apenas autenticacao; logica de quem-pode-fazer-o-que
-- fica no front (UI) e no backend FastAPI (service_role).
-- ==========================================

-- ====== emissoes_pacotes ======
DROP POLICY IF EXISTS pacotes_all_authenticated ON public.emissoes_pacotes;

CREATE POLICY pacotes_all_authenticated ON public.emissoes_pacotes
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ====== emissoes_arquivos (mesmo padrao defensivo) ======
DROP POLICY IF EXISTS arquivos_all_authenticated ON public.emissoes_arquivos;
DROP POLICY IF EXISTS "Allow all auth users" ON public.emissoes_arquivos;
DROP POLICY IF EXISTS emissoes_arquivos_all_authenticated ON public.emissoes_arquivos;

CREATE POLICY emissoes_arquivos_all_authenticated ON public.emissoes_arquivos
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ====== processos (mesmo padrao defensivo) ======
DROP POLICY IF EXISTS processos_all_authenticated ON public.processos;
DROP POLICY IF EXISTS "Allow all auth users" ON public.processos;

CREATE POLICY processos_all_authenticated ON public.processos
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ====== aprovacoes (logs de aprovacao) ======
DROP POLICY IF EXISTS aprovacoes_all_authenticated ON public.aprovacoes;
DROP POLICY IF EXISTS "Allow all auth users" ON public.aprovacoes;

CREATE POLICY aprovacoes_all_authenticated ON public.aprovacoes
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

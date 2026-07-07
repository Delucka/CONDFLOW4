-- ============================================================
-- 0073 — Religa RLS em rateios_config / rateios_valores
-- ============================================================
-- POR QUÊ: hoje o RLS está DESLIGADO nessas tabelas (migrations 0011/0018
-- dropadaram as políticas antigas ao trocar processo_id → condominio_id e
-- nunca as recriaram). Como o front escreve DIRETO no Supabase com a chave
-- pública (anon) na planilha, qualquer usuário logado podia, via API/DevTools,
-- ler/alterar os valores de verba de QUALQUER condomínio.
--
-- ESTE FIX: master = acesso total; gerente = SÓ os condomínios da sua carteira.
-- A leitura da planilha vem do backend (service-role, que IGNORA o RLS), então
-- este religamento NÃO afeta a leitura — só fecha o acesso direto pela anon key.
--
-- Executar no Supabase SQL Editor.
--
-- ⚠️ ROLLBACK IMEDIATO (se a planilha parar de salvar, rode estas 2 linhas):
--   ALTER TABLE public.rateios_config  DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.rateios_valores DISABLE ROW LEVEL SECURITY;
-- ============================================================

-- ── Limpa políticas antigas (idempotente) ──
DROP POLICY IF EXISTS "Master vê todos rateios_config"        ON public.rateios_config;
DROP POLICY IF EXISTS "Gerente vê seus rateios_config"        ON public.rateios_config;
DROP POLICY IF EXISTS "Gerente edita rateios_config em edição" ON public.rateios_config;
DROP POLICY IF EXISTS "rateios_config_master"                 ON public.rateios_config;
DROP POLICY IF EXISTS "rateios_config_gerente_carteira"       ON public.rateios_config;

DROP POLICY IF EXISTS "Master vê todos rateios_valores"        ON public.rateios_valores;
DROP POLICY IF EXISTS "Gerente vê seus rateios_valores"        ON public.rateios_valores;
DROP POLICY IF EXISTS "Gerente edita rateios_valores em edição" ON public.rateios_valores;
DROP POLICY IF EXISTS "rateios_valores_master"                ON public.rateios_valores;
DROP POLICY IF EXISTS "rateios_valores_gerente_carteira"      ON public.rateios_valores;

ALTER TABLE public.rateios_config  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rateios_valores ENABLE ROW LEVEL SECURITY;

-- ══════════════════ rateios_config ══════════════════
-- Master: tudo
CREATE POLICY "rateios_config_master" ON public.rateios_config
  FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'master'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'master'));

-- Gerente: só os condomínios da SUA carteira
CREATE POLICY "rateios_config_gerente_carteira" ON public.rateios_config
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'gerente'
        AND public.rateios_config.condominio_id IN (
          SELECT c.id FROM public.condominios c
          JOIN public.gerentes g ON c.gerente_id = g.id
          WHERE g.profile_id = auth.uid()
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'gerente'
        AND public.rateios_config.condominio_id IN (
          SELECT c.id FROM public.condominios c
          JOIN public.gerentes g ON c.gerente_id = g.id
          WHERE g.profile_id = auth.uid()
        )
    )
  );

-- ══════════════════ rateios_valores (via rateio_id → rateios_config.condominio_id) ══════════════════
-- Master: tudo
CREATE POLICY "rateios_valores_master" ON public.rateios_valores
  FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'master'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'master'));

-- Gerente: só valores de rateios de condomínios da SUA carteira
CREATE POLICY "rateios_valores_gerente_carteira" ON public.rateios_valores
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.rateios_config rc
      JOIN public.condominios c ON rc.condominio_id = c.id
      JOIN public.gerentes     g ON c.gerente_id    = g.id
      WHERE rc.id = public.rateios_valores.rateio_id AND g.profile_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.rateios_config rc
      JOIN public.condominios c ON rc.condominio_id = c.id
      JOIN public.gerentes     g ON c.gerente_id    = g.id
      WHERE rc.id = public.rateios_valores.rateio_id AND g.profile_id = auth.uid()
    )
  );

-- ── Conferência ──
-- SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('rateios_config','rateios_valores');
-- SELECT tablename, policyname, cmd FROM pg_policies WHERE tablename IN ('rateios_config','rateios_valores');

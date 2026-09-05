-- ============================================================================
-- 0118 — As férias alcançam a planilha (e o resto do RLS)
-- ============================================================================
--
-- O SINTOMA. O substituto abria a planilha do condomínio coberto, digitava os
-- valores e recebia "Erro ao salvar algumas informações". Ver, via; salvar, não.
--
-- A CAUSA. A 0117 ensinou três políticas a enxergar a cobertura
-- (emissoes_pacotes, emissoes_arquivos, condominios). Mas a planilha vive em
-- `rateios_config` / `rateios_valores`, cujas políticas (0073) resolvem carteira
-- com um JOIN próprio:
--
--     JOIN gerentes g ON c.gerente_id = g.id WHERE g.profile_id = auth.uid()
--
-- É a mesma pergunta errada que já apareceu em meia dúzia de telas: "de quem é
-- este condomínio?". Durante a cobertura a resposta continua sendo o gerente
-- ausente — então o banco recusa a escrita de quem foi encarregado de fazê-la.
--
-- ---- O que esta migration faz ----
--
-- 1. `condominios_da_carteira()` passa a incluir o que a pessoa cobre. É a
--    função que as políticas de `cobrancas_extras` (0081) e `processos` (0082)
--    já usam — as duas passam a enxergar a cobertura de graça, e qualquer
--    política futura que a use também.
--
-- 2. As duas políticas dos rateios passam a aceitar o condomínio coberto. Elas
--    continuam exigindo o papel de gerente para o caminho normal; a cobertura
--    vale por si, porque quem recebe carteira já foi escolhido para isso na
--    tela de ausência.
--
-- O que NÃO muda: fora do período, nada disso vale — `condominios_por_ausencia()`
-- filtra por `current_date BETWEEN`, e no dia seguinte a porta fecha sozinha.
--
-- ROLLBACK no fim do arquivo.
-- ============================================================================

-- ── 1. A função central ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.condominios_da_carteira()
RETURNS TABLE (condominio_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  -- gerente: a propria carteira
  SELECT c.id
    FROM public.condominios c
    JOIN public.gerentes g ON c.gerente_id = g.id
   WHERE g.profile_id = auth.uid()
  UNION
  -- assistente: a carteira do gerente a que esta vinculado (0057)
  SELECT c.id
    FROM public.condominios c
    JOIN public.gerentes g ON c.gerente_id = g.id
    JOIN public.profiles p ON p.gerente_id = g.profile_id
   WHERE p.id = auth.uid()
  UNION
  -- quem cobre ferias de alguem, enquanto o periodo vale (0117)
  SELECT ac.condominio_id
    FROM public.gerente_ausencia_condominios ac
    JOIN public.gerente_ausencias a ON a.id = ac.ausencia_id
   WHERE ac.substituto_id = auth.uid()
     AND a.encerrada_em IS NULL
     AND current_date BETWEEN a.data_inicio AND a.data_fim;
$fn$;


-- ── 2. A planilha ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "rateios_config_gerente_carteira" ON public.rateios_config;
CREATE POLICY "rateios_config_gerente_carteira" ON public.rateios_config
  FOR ALL TO authenticated
  USING (
    public.rateios_config.condominio_id IN (SELECT condominio_id FROM public.condominios_por_ausencia())
    OR EXISTS (
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
    public.rateios_config.condominio_id IN (SELECT condominio_id FROM public.condominios_por_ausencia())
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'gerente'
        AND public.rateios_config.condominio_id IN (
          SELECT c.id FROM public.condominios c
          JOIN public.gerentes g ON c.gerente_id = g.id
          WHERE g.profile_id = auth.uid()
        )
    )
  );

DROP POLICY IF EXISTS "rateios_valores_gerente_carteira" ON public.rateios_valores;
CREATE POLICY "rateios_valores_gerente_carteira" ON public.rateios_valores
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.rateios_config rc
       WHERE rc.id = public.rateios_valores.rateio_id
         AND rc.condominio_id IN (SELECT condominio_id FROM public.condominios_por_ausencia())
    )
    OR EXISTS (
      SELECT 1 FROM public.rateios_config rc
      JOIN public.condominios c ON rc.condominio_id = c.id
      JOIN public.gerentes     g ON c.gerente_id    = g.id
      WHERE rc.id = public.rateios_valores.rateio_id AND g.profile_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.rateios_config rc
       WHERE rc.id = public.rateios_valores.rateio_id
         AND rc.condominio_id IN (SELECT condominio_id FROM public.condominios_por_ausencia())
    )
    OR EXISTS (
      SELECT 1 FROM public.rateios_config rc
      JOIN public.condominios c ON rc.condominio_id = c.id
      JOIN public.gerentes     g ON c.gerente_id    = g.id
      WHERE rc.id = public.rateios_valores.rateio_id AND g.profile_id = auth.uid()
    )
  );


-- ============================================================================
-- CONFERIR (rode depois)
-- ============================================================================
-- A funcao central ja inclui a cobertura (deve vir 'ok'):
--   SELECT CASE WHEN prosrc LIKE '%gerente_ausencia_condominios%' THEN 'ok'
--               ELSE '>>> FALTA <<<' END AS veredito
--     FROM pg_proc WHERE proname = 'condominios_da_carteira';
--
-- As duas politicas da planilha tambem (2 linhas, ambas 'ok'):
--   SELECT tablename,
--          CASE WHEN qual LIKE '%condominios_por_ausencia%' THEN 'ok'
--               ELSE '>>> FALTA <<<' END AS veredito
--     FROM pg_policies
--    WHERE policyname IN ('rateios_config_gerente_carteira','rateios_valores_gerente_carteira');
--
-- Nenhuma politica de carteira ficou sem enxergar a ausencia:
--   SELECT tablename, policyname
--     FROM pg_policies
--    WHERE schemaname = 'public'
--      AND qual LIKE '%gerentes%profile_id%'
--      AND qual NOT LIKE '%ausencia%'
--      AND qual NOT LIKE '%condominios_da_carteira%';


-- ============================================================================
-- ROLLBACK
-- ============================================================================
-- `condominios_da_carteira()` como esta na 0080 (sem o terceiro UNION), e as
-- duas politicas de rateios como estao na 0073.

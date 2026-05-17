-- ==========================================
-- MIGRATION: Ciclo mensal de edicao por gerente
-- O master abre o periodo de edicao para o mes seguinte (M+1) e cada
-- condominio vira uma linha na fila do gerente responsavel. O gerente
-- "Libera" cada condo individualmente (ou todos de uma vez), e pode
-- "Solicitar reabertura" depois - master/emissor aprovam/negam.
-- ==========================================

CREATE TABLE IF NOT EXISTS public.edicoes_mensais (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  condominio_id UUID NOT NULL REFERENCES public.condominios(id) ON DELETE CASCADE,
  gerente_id UUID REFERENCES public.gerentes(id) ON DELETE SET NULL,
  mes_referencia SMALLINT NOT NULL CHECK (mes_referencia BETWEEN 1 AND 12),
  ano_referencia SMALLINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'em_edicao'
    CHECK (status IN ('em_edicao', 'edicao_finalizada', 'reabertura_solicitada')),
  -- audit
  aberto_por UUID REFERENCES public.profiles(id),
  aberto_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  liberado_em TIMESTAMPTZ,
  -- reabertura
  reabertura_solicitada_em TIMESTAMPTZ,
  reabertura_motivo TEXT,
  reabertura_respondida_em TIMESTAMPTZ,
  reabertura_respondida_por UUID REFERENCES public.profiles(id),
  reabertura_aprovada BOOLEAN,
  -- unicidade por condo/mes/ano
  UNIQUE(condominio_id, ano_referencia, mes_referencia)
);

CREATE INDEX IF NOT EXISTS idx_edicoes_gerente_status
  ON public.edicoes_mensais(gerente_id, status);

CREATE INDEX IF NOT EXISTS idx_edicoes_periodo
  ON public.edicoes_mensais(ano_referencia, mes_referencia);

CREATE INDEX IF NOT EXISTS idx_edicoes_condo
  ON public.edicoes_mensais(condominio_id);

-- RLS: padrao defensivo (autenticado pode tudo; logica fina no backend)
ALTER TABLE public.edicoes_mensais ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS edicoes_mensais_all_authenticated ON public.edicoes_mensais;
CREATE POLICY edicoes_mensais_all_authenticated ON public.edicoes_mensais
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

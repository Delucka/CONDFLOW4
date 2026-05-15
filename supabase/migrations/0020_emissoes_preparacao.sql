-- ==========================================
-- MIGRATION: Etapas de preparação pré-emissão
-- Permite o emissor registrar checkpoints (aguardando fatura, aguardando relatório)
-- com data antes de criar o pacote de emissão (rascunho).
-- ==========================================

CREATE TABLE IF NOT EXISTS public.emissoes_preparacao (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  condominio_id   UUID NOT NULL REFERENCES public.condominios(id) ON DELETE CASCADE,
  mes_referencia  INTEGER NOT NULL CHECK (mes_referencia BETWEEN 1 AND 12),
  ano_referencia  INTEGER NOT NULL,

  -- 'aguardando_fatura' | 'aguardando_relatorio' | 'pronto_para_emitir'
  etapa TEXT NOT NULL DEFAULT 'aguardando_fatura'
    CHECK (etapa IN ('aguardando_fatura','aguardando_relatorio','pronto_para_emitir')),

  data_fatura     DATE,   -- data prevista/realizada de emissão da fatura
  data_relatorio  DATE,   -- data prevista/realizada do relatório de faturas enviadas
  notas           TEXT,

  atualizado_por  UUID REFERENCES auth.users(id),
  atualizado_em   TIMESTAMPTZ DEFAULT now(),
  criado_em       TIMESTAMPTZ DEFAULT now(),

  UNIQUE (condominio_id, mes_referencia, ano_referencia)
);

CREATE INDEX IF NOT EXISTS idx_preparacao_condo_periodo
  ON public.emissoes_preparacao(condominio_id, ano_referencia, mes_referencia);

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.emissoes_preparacao;

-- RLS
ALTER TABLE public.emissoes_preparacao ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "preparacao_select" ON public.emissoes_preparacao;
CREATE POLICY "preparacao_select" ON public.emissoes_preparacao
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('master','departamento','supervisora','supervisora_contabilidade','supervisor_gerentes','gerente','assistente')
    )
  );

DROP POLICY IF EXISTS "preparacao_modify_master_emissor" ON public.emissoes_preparacao;
CREATE POLICY "preparacao_modify_master_emissor" ON public.emissoes_preparacao
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('master','departamento')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('master','departamento')
    )
  );

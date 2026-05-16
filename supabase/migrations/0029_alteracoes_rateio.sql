-- ==========================================
-- MIGRATION: Alterações de rateio (AGO/AGE/Reunião)
-- Marca por (condomínio + mês + ano) que vai ter — ou teve — uma alteração
-- por meio de Assembleia Geral Ordinária, Assembleia Geral Extraordinária ou Reunião.
-- ==========================================

CREATE TABLE IF NOT EXISTS public.alteracoes_rateio (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  condominio_id   UUID NOT NULL REFERENCES public.condominios(id) ON DELETE CASCADE,
  mes_referencia  INT  NOT NULL CHECK (mes_referencia BETWEEN 1 AND 12),
  ano_referencia  INT  NOT NULL,

  tipo            TEXT NOT NULL CHECK (tipo IN ('AGO','AGE','Reuniao')),
  data_evento     DATE NOT NULL,
  descricao       TEXT,

  -- prevista: ainda nao aconteceu (bloqueia criacao de pacote no emissor)
  -- realizada: aconteceu, valores ja refletem (libera emissor)
  -- cancelada: nao vai acontecer (libera emissor)
  status          TEXT NOT NULL DEFAULT 'prevista'
                    CHECK (status IN ('prevista','realizada','cancelada')),

  criado_por      UUID REFERENCES auth.users(id),
  atualizado_por  UUID REFERENCES auth.users(id),
  criado_em       TIMESTAMPTZ DEFAULT now(),
  atualizado_em   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_alteracoes_rateio_periodo
  ON public.alteracoes_rateio(condominio_id, ano_referencia, mes_referencia);
CREATE INDEX IF NOT EXISTS idx_alteracoes_rateio_status
  ON public.alteracoes_rateio(status);

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.alteracoes_rateio;

-- RLS
ALTER TABLE public.alteracoes_rateio ENABLE ROW LEVEL SECURITY;

-- Leitura: qualquer autenticado
DROP POLICY IF EXISTS "alteracoes_select_all" ON public.alteracoes_rateio;
CREATE POLICY "alteracoes_select_all" ON public.alteracoes_rateio
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- Escrita (INSERT/UPDATE/DELETE): master OU gerente do condominio
DROP POLICY IF EXISTS "alteracoes_write_master_or_gerente" ON public.alteracoes_rateio;
CREATE POLICY "alteracoes_write_master_or_gerente" ON public.alteracoes_rateio
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'master')
    OR EXISTS (
      SELECT 1 FROM public.condominios c
      JOIN public.gerentes g ON g.id = c.gerente_id
      WHERE c.id = alteracoes_rateio.condominio_id
        AND g.profile_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'master')
    OR EXISTS (
      SELECT 1 FROM public.condominios c
      JOIN public.gerentes g ON g.id = c.gerente_id
      WHERE c.id = alteracoes_rateio.condominio_id
        AND g.profile_id = auth.uid()
    )
  );

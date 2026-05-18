-- ==========================================
-- MIGRATION: Cadastro de quais concessionarias cada condo usa
-- Permite que /consumos mostre o condo mesmo sem fatura anexada ainda.
-- ==========================================

CREATE TABLE IF NOT EXISTS public.condominios_concessionarias (
  condominio_id UUID NOT NULL REFERENCES public.condominios(id) ON DELETE CASCADE,
  concessionaria TEXT NOT NULL,
  criado_em TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (condominio_id, concessionaria)
);

CREATE INDEX IF NOT EXISTS idx_condconc_concessionaria
  ON public.condominios_concessionarias(concessionaria);

ALTER TABLE public.condominios_concessionarias ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS condconc_all_authenticated ON public.condominios_concessionarias;
CREATE POLICY condconc_all_authenticated ON public.condominios_concessionarias
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ==========================================
-- MIGRATION 0047: Unidade(s) na cobrança extra
-- Toda cobrança extra deve informar a(s) unidade(s) do condomínio a que se refere.
-- ==========================================
ALTER TABLE public.cobrancas_extras
  ADD COLUMN IF NOT EXISTS unidades TEXT;

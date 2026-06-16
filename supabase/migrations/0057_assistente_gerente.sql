-- ==========================================
-- MIGRATION 0057: Vincular ASSISTENTE a um GERENTE
-- O assistente passa a "pertencer" à carteira de um gerente (um usuário gerente).
-- profiles.gerente_id aponta para o profile do gerente responsável.
-- A resolução para a carteira (condomínios) é: assistente.gerente_id (profile do gerente)
-- -> gerentes.profile_id -> gerentes.id -> condominios.gerente_id.
-- ==========================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS gerente_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_gerente ON public.profiles(gerente_id) WHERE gerente_id IS NOT NULL;

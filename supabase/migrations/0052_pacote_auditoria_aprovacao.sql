-- ==========================================
-- MIGRATION 0052: Trilha de aprovação/correção no pacote de emissão
-- Registra QUEM aprovou/pediu correção e QUANDO (exibido no fluxo de registro).
-- Denormalizado (nome + role) p/ o front exibir sem join.
-- ==========================================
ALTER TABLE public.emissoes_pacotes
  ADD COLUMN IF NOT EXISTS aprovado_por_nome TEXT,
  ADD COLUMN IF NOT EXISTS aprovado_por_role TEXT,
  ADD COLUMN IF NOT EXISTS aprovado_em       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS correcao_por_nome TEXT,
  ADD COLUMN IF NOT EXISTS correcao_em       TIMESTAMPTZ;

-- ==========================================
-- MIGRATION 0056: Características (especificações) por condomínio
-- Texto livre editável e auto-salvo na tela de emissão (sempre visível).
-- Ex.: regras de rateio, salão de festas, observações de cobrança.
-- ==========================================

ALTER TABLE public.condominios ADD COLUMN IF NOT EXISTS caracteristicas TEXT;

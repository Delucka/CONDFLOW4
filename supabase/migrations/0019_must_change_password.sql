-- ==========================================
-- MIGRATION: Senha temporária + troca obrigatória no primeiro acesso
-- Execute no SQL Editor do Supabase
-- ==========================================

-- Flag indicando que o usuário precisa trocar a senha antes de usar o sistema
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT FALSE;

-- Timestamp da última troca (para auditoria)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;

-- Backfill: contas existentes ja usaram o sistema, nao forçar troca
UPDATE public.profiles
  SET must_change_password = FALSE
  WHERE must_change_password IS NULL;

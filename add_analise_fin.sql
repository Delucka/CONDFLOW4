-- Execute este script no painel do Supabase para refletirmos os campos idênticos ao Ahreas
ALTER TABLE public.rateios_config ADD COLUMN IF NOT EXISTS conta_analise_fin TEXT;
ALTER TABLE public.rateios_config ADD COLUMN IF NOT EXISTS conta_analise_nome TEXT;

-- ═══════════════════════════════════════════════════════════════
-- CondoFlow — Migração: Cobranças Extras Parceladas
-- Execute no SQL Editor do Supabase
-- ═══════════════════════════════════════════════════════════════

-- 1. Adicionar colunas na tabela cobrancas_extras
ALTER TABLE public.cobrancas_extras
  ADD COLUMN IF NOT EXISTS mes INTEGER,
  ADD COLUMN IF NOT EXISTS ano INTEGER,
  ADD COLUMN IF NOT EXISTS parcela_atual INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS parcela_total INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS grupo_id UUID,          -- agrupa todas as parcelas de um lançamento
  ADD COLUMN IF NOT EXISTS condominio_id UUID REFERENCES public.condominios(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'ativa',  -- 'ativa' | 'cancelada' | 'solicitado_cancelamento'
  ADD COLUMN IF NOT EXISTS motivo_cancelamento TEXT,
  ADD COLUMN IF NOT EXISTS solicitado_por UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancelado_por UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- 2. Índices para performance
CREATE INDEX IF NOT EXISTS idx_cobrancas_grupo ON public.cobrancas_extras(grupo_id);
CREATE INDEX IF NOT EXISTS idx_cobrancas_condo_mes ON public.cobrancas_extras(condominio_id, mes, ano);
CREATE INDEX IF NOT EXISTS idx_cobrancas_status ON public.cobrancas_extras(status);

-- 3. Backfill: preenche condominio_id nas cobranças antigas via processo_id
UPDATE public.cobrancas_extras ce
SET condominio_id = p.condominio_id
FROM public.processos p
WHERE ce.processo_id = p.id
AND ce.condominio_id IS NULL;

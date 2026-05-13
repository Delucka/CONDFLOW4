-- ============================================================
-- FIX: Alinhar schema de rateios_config e rateios_valores
-- com o código Python (main.py)
-- 
-- Executar no Supabase SQL Editor
-- ============================================================

-- ─── 1. PRIMEIRO: Remover policies que dependem de processo_id ──────
-- (Sem isso, não conseguimos dropar a coluna)

DROP POLICY IF EXISTS "Master vê todos rateios_config" ON public.rateios_config;
DROP POLICY IF EXISTS "Gerente vê seus rateios_config" ON public.rateios_config;
DROP POLICY IF EXISTS "Gerente edita rateios_config em edição" ON public.rateios_config;
DROP POLICY IF EXISTS "Master vê todos rateios_valores" ON public.rateios_valores;
DROP POLICY IF EXISTS "Gerente vê seus rateios_valores" ON public.rateios_valores;
DROP POLICY IF EXISTS "Gerente edita rateios_valores em edição" ON public.rateios_valores;

-- Desabilitar RLS nas tabelas de rateios
ALTER TABLE public.rateios_config DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.rateios_valores DISABLE ROW LEVEL SECURITY;


-- ─── 2. rateios_config: trocar processo_id por condominio_id ────────

-- 2a. Adicionar nova coluna condominio_id
ALTER TABLE public.rateios_config 
  ADD COLUMN IF NOT EXISTS condominio_id UUID REFERENCES public.condominios(id) ON DELETE CASCADE;

-- 2b. Migrar dados existentes (se houver linhas com processo_id)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'rateios_config' AND column_name = 'processo_id'
  ) THEN
    UPDATE public.rateios_config rc
    SET condominio_id = p.condominio_id
    FROM public.processos p
    WHERE rc.processo_id = p.id
      AND rc.condominio_id IS NULL;
  END IF;
END $$;

-- 2c. Remover FK e coluna antiga processo_id
ALTER TABLE public.rateios_config DROP CONSTRAINT IF EXISTS rateios_config_processo_id_fkey;
ALTER TABLE public.rateios_config DROP COLUMN IF EXISTS processo_id;

-- 2d. Criar índice por condominio_id
DROP INDEX IF EXISTS idx_rateios_config_processo;
CREATE INDEX IF NOT EXISTS idx_rateios_config_condominio ON public.rateios_config(condominio_id);


-- ─── 3. rateios_config: adicionar colunas de parcelamento ───────────

ALTER TABLE public.rateios_config ADD COLUMN IF NOT EXISTS is_parcelado BOOLEAN DEFAULT FALSE;
ALTER TABLE public.rateios_config ADD COLUMN IF NOT EXISTS parcela_total INTEGER DEFAULT 1;
ALTER TABLE public.rateios_config ADD COLUMN IF NOT EXISTS parcela_inicio INTEGER DEFAULT 1;
ALTER TABLE public.rateios_config ADD COLUMN IF NOT EXISTS mes_inicio INTEGER DEFAULT 1;


-- ─── 4. rateios_valores: adicionar coluna ano ───────────────────────

ALTER TABLE public.rateios_valores ADD COLUMN IF NOT EXISTS ano INTEGER NOT NULL DEFAULT 2026;

-- 4a. Remover constraint UNIQUE antiga (rateio_id, month)
ALTER TABLE public.rateios_valores DROP CONSTRAINT IF EXISTS rateios_valores_rateio_id_month_key;

-- 4b. Criar nova constraint UNIQUE (rateio_id, month, ano)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'rateios_valores_rateio_id_month_ano_key'
  ) THEN
    ALTER TABLE public.rateios_valores 
      ADD CONSTRAINT rateios_valores_rateio_id_month_ano_key UNIQUE(rateio_id, month, ano);
  END IF;
END $$;


-- ─── 5. Verificação ─────────────────────────────────────────────────

SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns 
WHERE table_name = 'rateios_config' AND table_schema = 'public'
ORDER BY ordinal_position;

SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns 
WHERE table_name = 'rateios_valores' AND table_schema = 'public'
ORDER BY ordinal_position;

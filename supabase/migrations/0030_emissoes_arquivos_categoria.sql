-- ==========================================
-- MIGRATION: Categoria + subtipo em emissoes_arquivos
-- 3 categorias: emissao (default), concessionaria, outros
-- subtipo livre para detalhar (ex: SABESP, COMGAS, ENEL, etc)
-- ==========================================

ALTER TABLE public.emissoes_arquivos
  ADD COLUMN IF NOT EXISTS categoria TEXT NOT NULL DEFAULT 'emissao';

-- Garante consistencia dos valores (idempotente)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'emissoes_arquivos'
      AND constraint_name = 'emissoes_arquivos_categoria_check'
  ) THEN
    ALTER TABLE public.emissoes_arquivos
      ADD CONSTRAINT emissoes_arquivos_categoria_check
      CHECK (categoria IN ('emissao', 'concessionaria', 'outros'));
  END IF;
END $$;

ALTER TABLE public.emissoes_arquivos
  ADD COLUMN IF NOT EXISTS subtipo TEXT;

CREATE INDEX IF NOT EXISTS idx_emissoes_arquivos_categoria
  ON public.emissoes_arquivos(pacote_id, categoria);

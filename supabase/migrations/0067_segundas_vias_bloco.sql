-- MIGRATION 0067: campo "bloco" nos pedidos de 2ª via
ALTER TABLE public.segundas_vias ADD COLUMN IF NOT EXISTS bloco text;

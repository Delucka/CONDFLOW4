-- MIGRATION 0070: estado das conversas do chatbot de 2ª via (fluxo guiado)
-- O n8n é só o cano; o estado/lógica do bot vive no backend.
CREATE TABLE IF NOT EXISTS public.wa_conversas (
  phone          text PRIMARY KEY,
  etapa          text NOT NULL DEFAULT 'inicio',
  dados          jsonb NOT NULL DEFAULT '{}'::jsonb,
  atualizado_em  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.wa_conversas ENABLE ROW LEVEL SECURITY;

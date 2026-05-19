-- ==========================================
-- MIGRATION: Anexo opcional em solicitacao de correcao
-- Quem solicita pode subir um PDF/imagem que ajuda a explicar o problema.
-- ==========================================

ALTER TABLE public.emissoes_pacotes
  ADD COLUMN IF NOT EXISTS correcao_arquivo_url TEXT;

ALTER TABLE public.emissoes_pacotes
  ADD COLUMN IF NOT EXISTS correcao_arquivo_nome TEXT;

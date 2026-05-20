-- ==========================================
-- MIGRATION: Resposta de correcao + observacao de aprovacao
-- - Gerente anexa o arquivo corrigido + descreve o que foi feito ao reenviar
-- - Master/sup pode adicionar observacao opcional ao aprovar
-- ==========================================

ALTER TABLE public.emissoes_pacotes
  ADD COLUMN IF NOT EXISTS resposta_correcao_arquivo_url TEXT;

ALTER TABLE public.emissoes_pacotes
  ADD COLUMN IF NOT EXISTS resposta_correcao_arquivo_nome TEXT;

ALTER TABLE public.emissoes_pacotes
  ADD COLUMN IF NOT EXISTS resposta_correcao_comentario TEXT;

ALTER TABLE public.emissoes_pacotes
  ADD COLUMN IF NOT EXISTS resposta_correcao_em TIMESTAMPTZ;

ALTER TABLE public.emissoes_pacotes
  ADD COLUMN IF NOT EXISTS observacao_aprovacao TEXT;

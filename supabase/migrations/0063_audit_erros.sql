-- ==========================================
-- MIGRATION 0063: Log de erros/quebras (monitor de código na auditoria)
-- Captura exceções não tratadas do backend (500) para a aba "Erros" da Auditoria.
-- Escrita/leitura só pelo backend (service-role); RLS ligado sem policy pública.
-- ==========================================

CREATE TABLE IF NOT EXISTS public.audit_erros (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  criado_em   timestamptz NOT NULL DEFAULT now(),
  rota        text,          -- caminho do endpoint
  metodo      text,          -- GET/POST/...
  status_code int,
  mensagem    text,          -- "TipoErro: mensagem"
  detalhe     text,          -- traceback / contexto
  user_id     uuid,          -- quem disparou (quando disponível)
  user_nome   text
);

CREATE INDEX IF NOT EXISTS idx_audit_erros_criado ON public.audit_erros(criado_em DESC);

ALTER TABLE public.audit_erros ENABLE ROW LEVEL SECURITY;

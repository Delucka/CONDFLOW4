-- ==========================================
-- MIGRATION 0065: Fila de Segundas Vias (pedidos de boleto 2ª via)
-- Centraliza no site o que hoje vem por e-mail. Carteira abre o pedido; o time
-- (departamento/master) atende, anexa o boleto e dispara o e-mail padrão.
-- ==========================================

CREATE TABLE IF NOT EXISTS public.segundas_vias (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  condominio_id  uuid NOT NULL REFERENCES public.condominios(id) ON DELETE CASCADE,
  unidade        text NOT NULL,
  ref_mes        int,
  ref_ano        int,
  vencimento     date,
  modalidade     text NOT NULL DEFAULT 'com_multa'
                   CHECK (modalidade IN ('com_multa', 'sem_multa', 'quinto_andar')),
  email_destinatario text,                 -- p/ quem o boleto será enviado
  observacoes    text,
  anexo_url      text,                      -- autorização (obrigatória p/ sem_multa)
  anexo_nome     text,

  status         text NOT NULL DEFAULT 'pendente'
                   CHECK (status IN ('pendente', 'emitido', 'cancelado')),

  -- quem pediu (a carteira / assistente)
  criado_por       uuid REFERENCES public.profiles(id),
  criado_por_nome  text,
  criado_por_email text,
  criado_em        timestamptz NOT NULL DEFAULT now(),

  -- atendimento (time de 2ª via)
  boleto_url     text,                      -- boleto emitido, anexado
  boleto_nome    text,
  atendido_por   uuid REFERENCES public.profiles(id),
  atendido_em    timestamptz,
  email_enviado  boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_segvias_status     ON public.segundas_vias(status, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_segvias_condominio ON public.segundas_vias(condominio_id);

ALTER TABLE public.segundas_vias ENABLE ROW LEVEL SECURITY;
-- Backend usa service-role (bypassa RLS). RLS ligado sem policy = nada de acesso anônimo.

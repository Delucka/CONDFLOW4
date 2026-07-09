-- ==========================================
-- MIGRATION 0074: Histórico/auditoria das Segundas Vias
-- Cada 2ª via passa a ter uma LINHA DO TEMPO: criação, pedidos de alteração
-- (quem pediu, quando, motivo) e CADA emissão de boleto (arquivo preservado,
-- não sobrescrito). Assim dá pra comparar os boletos e comprovar o que mudou.
-- ==========================================

CREATE TABLE IF NOT EXISTS public.segundas_vias_historico (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  segunda_via_id  uuid NOT NULL REFERENCES public.segundas_vias(id) ON DELETE CASCADE,
  tipo            text NOT NULL
                    CHECK (tipo IN ('criacao', 'solicitacao_alteracao', 'emissao', 'cancelamento')),

  -- snapshot dos dados no momento do evento (o que valia naquela versão)
  vencimento      date,
  ref_mes         int,
  ref_ano         int,
  modalidade      text,
  email_destinatario text,

  -- boleto daquele momento (só em tipo='emissao') — arquivo no bucket 'emissoes'
  boleto_url      text,
  boleto_nome     text,
  email_enviado   boolean,

  -- pedido de alteração
  motivo          text,       -- por que foi pedida a alteração
  detalhes        text,       -- de->para legível (ex.: "venc 30/06/2026 -> 10/07/2026")

  -- autor do evento
  autor_id        uuid REFERENCES public.profiles(id),
  autor_nome      text,
  criado_em       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_segvias_hist_sv
  ON public.segundas_vias_historico(segunda_via_id, criado_em);

-- Backend usa service-role (bypassa RLS). RLS ligado sem policy = nada de acesso anônimo.
ALTER TABLE public.segundas_vias_historico ENABLE ROW LEVEL SECURITY;

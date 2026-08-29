-- ============================================================================
-- 0105 — Alterar cobrança extra depende de aprovação
-- ============================================================================
--
-- Hoje uma cobrança lançada é imutável: para trocar o mês das cinco
-- churrasqueiras de setembro para outubro, só cancelando e lançando de novo —
-- o que perde o documento anexado e a data do lançamento original.
--
-- O molde é o cancelamento, que já funciona: gerente e assistente PEDEM, master
-- e departamento DECIDEM. Aqui é a mesma coisa, com uma diferença: o pedido
-- carrega os valores propostos, e eles só entram na linha quando alguém aprova.
--
-- Os valores propostos ficam em JSONB, não em colunas espelho. Um par
-- `valor_novo`/`mes_novo` por campo vira seis colunas mortas entre um pedido e
-- outro, e a sétima vem quando alguém quiser editar mais um campo.
--
-- IMPORTANTE — cobrança com alteração pendente NÃO entra em emissão. Cobrar um
-- valor que está sob revisão é exatamente o erro que esta aprovação existe para
-- evitar; a trava fica no mesmo lugar da trava de documento faltando.
-- ============================================================================

ALTER TABLE public.cobrancas_extras
  ADD COLUMN IF NOT EXISTS alteracao_proposta JSONB,
  ADD COLUMN IF NOT EXISTS alteracao_motivo TEXT,
  ADD COLUMN IF NOT EXISTS alteracao_pedida_por TEXT,
  ADD COLUMN IF NOT EXISTS alteracao_pedida_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS alteracao_decidida_por TEXT,
  ADD COLUMN IF NOT EXISTS alteracao_decidida_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS alteracao_recusa_motivo TEXT;

COMMENT ON COLUMN public.cobrancas_extras.alteracao_proposta IS
  'O que se quer mudar, campo a campo: {"amount": 120, "mes": 10, "ano": 2026, "description": "…", "unidades": "…"}. Nulo = nada pendente.';
COMMENT ON COLUMN public.cobrancas_extras.alteracao_motivo IS
  'Por que a mudança foi pedida. Obrigatório — sem isto, quem aprova decide no escuro.';
COMMENT ON COLUMN public.cobrancas_extras.alteracao_recusa_motivo IS
  'Por que foi recusada. Quem pediu precisa saber o que fazer em seguida.';

-- Quem tem alteração esperando decisão. Índice parcial: a esmagadora maioria
-- das linhas tem `alteracao_proposta` nula e não precisa ocupar índice.
CREATE INDEX IF NOT EXISTS idx_cobrancas_alteracao_pendente
  ON public.cobrancas_extras(condominio_id)
  WHERE alteracao_proposta IS NOT NULL;

-- Histórico das decisões. A linha da cobrança guarda só o pedido em aberto; o
-- que já foi decidido tem de sobreviver ao próximo pedido, senão a segunda
-- alteração apaga o rastro da primeira.
CREATE TABLE IF NOT EXISTS public.cobrancas_alteracoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cobranca_id UUID REFERENCES public.cobrancas_extras(id) ON DELETE CASCADE NOT NULL,
  antes JSONB NOT NULL,
  proposta JSONB NOT NULL,
  motivo TEXT,
  decisao TEXT NOT NULL CHECK (decisao IN ('aprovada', 'recusada')),
  decisao_motivo TEXT,
  pedida_por TEXT,
  pedida_em TIMESTAMPTZ,
  decidida_por TEXT,
  decidida_em TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cobrancas_alteracoes_cobranca
  ON public.cobrancas_alteracoes(cobranca_id);

ALTER TABLE public.cobrancas_alteracoes ENABLE ROW LEVEL SECURITY;

-- Leitura para quem está autenticado; escrita só pela API (service role, que
-- não passa por RLS). O mesmo desenho das outras tabelas de histórico: ninguém
-- edita rastro de auditoria pelo navegador.
DROP POLICY IF EXISTS cobrancas_alteracoes_leitura ON public.cobrancas_alteracoes;
CREATE POLICY cobrancas_alteracoes_leitura ON public.cobrancas_alteracoes
  FOR SELECT TO authenticated USING (true);


-- ============================================================================
-- CONFERIR (rode depois)
-- ============================================================================
-- SELECT description, mes, ano, amount, alteracao_proposta, alteracao_motivo
--   FROM cobrancas_extras
--  WHERE alteracao_proposta IS NOT NULL;


-- ============================================================================
-- REVERTER
-- ============================================================================
-- DROP TABLE IF EXISTS public.cobrancas_alteracoes;
-- DROP INDEX IF EXISTS idx_cobrancas_alteracao_pendente;
-- ALTER TABLE public.cobrancas_extras
--   DROP COLUMN IF EXISTS alteracao_proposta,
--   DROP COLUMN IF EXISTS alteracao_motivo,
--   DROP COLUMN IF EXISTS alteracao_pedida_por,
--   DROP COLUMN IF EXISTS alteracao_pedida_em,
--   DROP COLUMN IF EXISTS alteracao_decidida_por,
--   DROP COLUMN IF EXISTS alteracao_decidida_em,
--   DROP COLUMN IF EXISTS alteracao_recusa_motivo;

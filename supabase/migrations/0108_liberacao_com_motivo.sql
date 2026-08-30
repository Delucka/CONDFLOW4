-- ============================================================================
-- 0108 — Mês sem valores precisa de motivo, e a AGO trava o que vem depois
-- ============================================================================
--
-- DUAS REGRAS que a operação pediu, e que o banco precisa sustentar:
--
-- 1. Mês sem valor não é liberado calado. Se o gerente vai embora deixando
--    dezembro vazio, alguém vai perguntar por quê — e a resposta tem de estar
--    no sistema, não na memória de quem preencheu.
--
--    O motivo vem de uma lista curta, não de texto livre. Motivo digitado à mão
--    vira quarenta redações da mesma coisa, e aí ninguém consegue contar
--    quantos condomínios estão parados esperando assembleia. O texto livre fica
--    no detalhe, ao lado, para o que a lista não cobre.
--
-- 2. AGO/AGE/reunião prevista trava o mês dela E os seguintes. Uma assembleia
--    decide o orçamento: emitir os meses posteriores antes dela é emitir o
--    valor que ela está prestes a mudar. A trava cai quando a alteração for
--    marcada como realizada — não pelo calendário, porque assembleia adia.
--
--    Esta migration não implementa a trava em trigger de propósito: liberar é
--    decisão que passa pela API, onde a mensagem de recusa pode dizer QUAL
--    assembleia está travando e o que fazer. Um trigger só diria "não".
-- ============================================================================

ALTER TABLE public.edicoes_mensais
  ADD COLUMN IF NOT EXISTS motivo_sem_valores TEXT,
  ADD COLUMN IF NOT EXISTS motivo_detalhe TEXT,
  ADD COLUMN IF NOT EXISTS motivo_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS motivo_por UUID;

COMMENT ON COLUMN public.edicoes_mensais.motivo_sem_valores IS
  'Por que o mês está sem valores. Lista curta — o texto livre vai em motivo_detalhe.';

-- Só marca o instante quando o motivo muda: sem isto, qualquer salvamento da
-- linha renovaria a data e a explicação pareceria recém-dada.
CREATE OR REPLACE FUNCTION public.tg_edicao_motivo_carimbo()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.motivo_sem_valores IS DISTINCT FROM OLD.motivo_sem_valores
     OR NEW.motivo_detalhe IS DISTINCT FROM OLD.motivo_detalhe THEN
    NEW.motivo_em := now();
    NEW.motivo_por := COALESCE(NEW.motivo_por, auth.uid());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_edicao_motivo_carimbo ON public.edicoes_mensais;
CREATE TRIGGER trg_edicao_motivo_carimbo
  BEFORE UPDATE ON public.edicoes_mensais
  FOR EACH ROW EXECUTE FUNCTION public.tg_edicao_motivo_carimbo();


-- ── O que trava cada mês ────────────────────────────────────────────────────
-- Para um condomínio e um ano, devolve o primeiro mês com alteração ainda
-- prevista. Desse mês em diante, nada é liberado até alguém marcar a alteração
-- como realizada.
--
-- Função em vez de repetir a consulta: a regra "e os meses seguintes" é fácil
-- de escrever errado, e escrita em dois lugares um deles esquece o "seguintes".
CREATE OR REPLACE FUNCTION public.mes_travado_por_alteracao(
  p_condominio_id UUID,
  p_ano INT
)
RETURNS INT
LANGUAGE sql
STABLE
AS $$
  SELECT MIN(mes_referencia)
    FROM public.alteracoes_rateio
   WHERE condominio_id = p_condominio_id
     AND ano_referencia = p_ano
     AND status = 'prevista';
$$;


-- ============================================================================
-- CONFERIR (rode depois)
-- ============================================================================
-- Quem está travado hoje, e a partir de qual mês:
--
-- SELECT c.name,
--        public.mes_travado_por_alteracao(c.id, 2026) AS trava_a_partir_do_mes
--   FROM condominios c
--  WHERE c.situacao = 'ativo'
--    AND public.mes_travado_por_alteracao(c.id, 2026) IS NOT NULL
--  ORDER BY 2, 1;


-- ============================================================================
-- REVERTER
-- ============================================================================
-- DROP FUNCTION IF EXISTS public.mes_travado_por_alteracao(UUID, INT);
-- DROP TRIGGER IF EXISTS trg_edicao_motivo_carimbo ON public.edicoes_mensais;
-- DROP FUNCTION IF EXISTS public.tg_edicao_motivo_carimbo();
-- ALTER TABLE public.edicoes_mensais
--   DROP COLUMN IF EXISTS motivo_sem_valores,
--   DROP COLUMN IF EXISTS motivo_detalhe,
--   DROP COLUMN IF EXISTS motivo_em,
--   DROP COLUMN IF EXISTS motivo_por;

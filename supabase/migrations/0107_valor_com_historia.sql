-- ============================================================================
-- 0107 — Cada valor da planilha passa a ter história
-- ============================================================================
--
-- O PROBLEMA. `rateios_valores` guarda id, rateio_id, month, valor, ano. Só
-- isso. Um número que aparece na emissão de dezembro pode ter sido digitado em
-- agosto, por alguém que nem trabalha mais aqui, e o sistema não sabe dizer.
--
-- É por isso que o gerente preencher vários meses adiantado não é seguro hoje:
-- o que falta não é travar o preenchimento — é o valor não ter história. Sem
-- saber QUANDO foi digitado, não dá para distinguir "previsão feita em agosto"
-- de "valor conferido ontem", e os dois saem no boleto com a mesma cara.
--
-- Hoje: novembro e dezembro já têm 61 valores digitados e nunca tiveram quadro
-- de mês aberto.
--
-- A ESCOLHA. O carimbo é feito por TRIGGER, não pelo código da aplicação.
-- A planilha é escrita de mais de um lugar (o navegador escreve direto no
-- Supabase, a API escreve com service role), e carimbo aplicado por código
-- depende de cada caminho lembrar de carimbar. Um deles esquece — normalmente o
-- que foi escrito depois. No banco, não há como escapar.
--
-- As linhas que já existem ficam com carimbo NULO de propósito. Preencher com
-- `now()` diria que 3.504 valores foram digitados hoje, o que é mentira, e
-- mentira com carimbo é pior do que ausência de carimbo. Nulo se lê como "não
-- se sabe" — que é a verdade sobre elas.
-- ============================================================================

ALTER TABLE public.rateios_valores
  ADD COLUMN IF NOT EXISTS atualizado_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS atualizado_por UUID;

COMMENT ON COLUMN public.rateios_valores.atualizado_em IS
  'Quando este valor foi digitado pela última vez. Nulo = antes desta coluna existir (0107).';
COMMENT ON COLUMN public.rateios_valores.atualizado_por IS
  'Quem digitou (profiles.id). Nulo quando veio da API com service role ou antes da 0107.';


CREATE OR REPLACE FUNCTION public.tg_rateio_valor_carimbo()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Só carimba quando o VALOR muda. Sem esta guarda, qualquer atualização de
  -- outra coluna (ou um salvamento que reescreve a linha igual) renovaria a
  -- data e o valor pareceria recém-conferido sem ninguém ter olhado para ele.
  IF TG_OP = 'INSERT' OR NEW.valor IS DISTINCT FROM OLD.valor THEN
    NEW.atualizado_em := now();
    -- Quem escreve pelo navegador tem sessão; a API usa service role e não tem.
    -- `auth.uid()` nulo é honesto: diz que a mão foi do sistema, não de alguém.
    NEW.atualizado_por := COALESCE(NEW.atualizado_por, auth.uid());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rateio_valor_carimbo ON public.rateios_valores;
CREATE TRIGGER trg_rateio_valor_carimbo
  BEFORE INSERT OR UPDATE ON public.rateios_valores
  FOR EACH ROW EXECUTE FUNCTION public.tg_rateio_valor_carimbo();


-- ── O que a emissão precisa saber, em uma consulta ──────────────────────────
-- Um valor é "previsão não revisada" quando foi digitado ANTES de o quadro
-- daquele mês abrir — ou quando o quadro nunca abriu. É o caso de novembro e
-- dezembro hoje: números prontos para um mês que ninguém começou a trabalhar.
--
-- View em vez de repetir a comparação em cada consulta: repetida, uma delas
-- esquece o caso do quadro inexistente, e aí o aviso some justamente onde ele
-- mais importa.
CREATE OR REPLACE VIEW public.rateios_valores_revisao AS
  SELECT rv.id,
         rv.rateio_id,
         rv.month,
         rv.ano,
         rv.valor,
         rv.atualizado_em,
         rv.atualizado_por,
         rc.condominio_id,
         em.aberto_em            AS mes_aberto_em,
         em.status               AS mes_status,
         CASE
           WHEN rv.atualizado_em IS NULL THEN NULL          -- não se sabe
           WHEN em.aberto_em IS NULL THEN TRUE              -- mês nunca abriu
           WHEN rv.atualizado_em < em.aberto_em THEN TRUE   -- digitado antes de abrir
           ELSE FALSE
         END                     AS previsao_nao_revisada
    FROM public.rateios_valores rv
    JOIN public.rateios_config rc ON rc.id = rv.rateio_id
    LEFT JOIN public.edicoes_mensais em
           ON em.condominio_id = rc.condominio_id
          AND em.mes_referencia = rv.month
          AND em.ano_referencia = rv.ano;


-- ============================================================================
-- CONFERIR (rode depois)
-- ============================================================================
-- Deve mostrar as colunas novas, todas nulas ainda — nada foi digitado desde
-- que o carimbo existe:
--
-- SELECT count(*) AS total,
--        count(atualizado_em) AS com_carimbo
--   FROM rateios_valores;
--
-- E o retrato do que a emissão vai avisar (nulo = não se sabe, ainda):
--
-- SELECT ano, month, previsao_nao_revisada, count(*)
--   FROM rateios_valores_revisao
--  WHERE ano = 2026 GROUP BY 1,2,3 ORDER BY 1,2;


-- ============================================================================
-- REVERTER
-- ============================================================================
-- DROP VIEW IF EXISTS public.rateios_valores_revisao;
-- DROP TRIGGER IF EXISTS trg_rateio_valor_carimbo ON public.rateios_valores;
-- DROP FUNCTION IF EXISTS public.tg_rateio_valor_carimbo();
-- ALTER TABLE public.rateios_valores
--   DROP COLUMN IF EXISTS atualizado_em,
--   DROP COLUMN IF EXISTS atualizado_por;

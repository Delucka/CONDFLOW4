-- ============================================================
-- 0087 — O conjunto sai junto: trava no banco, não só na tela
-- ============================================================
-- A 0086 derrubou o UNIQUE(condominio_id, mes, ano) de propósito, para que um
-- condomínio de dois vencimentos possa ter duas emissões no mesmo mês. Isso
-- criou um risco que não existia: metade dos boletos sair e a outra metade
-- ficar presa em aprovação. Para o condômino, receber parte da cobrança é pior
-- que receber tudo um dia depois.
--
-- A regra do usuário, textual: "de fato é para que trave as outras se uma não
-- for aprovada, se são um conjunto todas devem sair de forma correta".
--
-- O front já bloqueia (lib/conjuntoEmissao.js). Isso não basta: o navegador
-- escreve DIRETO no Supabase com a chave `anon`, então a checagem da tela é
-- conselho, não trava. Quem trava de verdade é o banco.
--
-- ── O QUE ESTA MIGRATION FAZ ──
--   Um trigger BEFORE UPDATE que recusa `status = 'registrado'` enquanto
--   existir irmã do mesmo condomínio+mês fora de (aprovado, registrado,
--   expedida).
--
-- ── O QUE ELA NÃO FAZ ──
--   • Não mexe em quem já está registrado — só na TRANSIÇÃO para registrado.
--   • Não devolve o conjunto numa recusa; isso continua no front, porque
--     depende do motivo digitado por quem recusou.
--   • Num condomínio de vencimento único (277 de 303) o conjunto tem uma só
--     emissão e o trigger nunca dispara.
--
-- ⚠️ O backend usa service-role, que ignora RLS — mas NÃO ignora trigger.
--    Verificado em 04/08/2026: nenhum endpoint do FastAPI grava
--    status='registrado'; só o front. Se algum passar a gravar, ele também
--    passa a obedecer esta regra, que é o desejado.
--
-- ⚠️ ROLLBACK:
--   DROP TRIGGER IF EXISTS trg_conjunto_emissao ON public.emissoes_pacotes;
--   DROP FUNCTION IF EXISTS public.checa_conjunto_emissao();
-- ============================================================

CREATE OR REPLACE FUNCTION public.checa_conjunto_emissao()
RETURNS trigger
LANGUAGE plpgsql
AS $conjunto$
DECLARE
  faltam integer;
BEGIN
  -- Só interessa a transição PARA registrado. Update de qualquer outro campo
  -- numa emissão já registrada passa direto.
  IF NEW.status <> 'registrado' OR OLD.status = 'registrado' THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO faltam
    FROM public.emissoes_pacotes p
   WHERE p.condominio_id   = NEW.condominio_id
     AND p.mes_referencia  = NEW.mes_referencia
     AND p.ano_referencia  = NEW.ano_referencia
     AND p.id <> NEW.id
     AND p.status NOT IN ('aprovado', 'registrado', 'expedida');

  IF faltam > 0 THEN
    RAISE EXCEPTION
      'Faltam % emissão(ões) deste condomínio em %/% para aprovar. Os boletos do mês saem juntos.',
      faltam, lpad(NEW.mes_referencia::text, 2, '0'), NEW.ano_referencia
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$conjunto$;

DROP TRIGGER IF EXISTS trg_conjunto_emissao ON public.emissoes_pacotes;
CREATE TRIGGER trg_conjunto_emissao
  BEFORE UPDATE ON public.emissoes_pacotes
  FOR EACH ROW
  EXECUTE FUNCTION public.checa_conjunto_emissao();

-- ── Conferência ──
-- O trigger existe (1 linha):
--   SELECT tgname FROM pg_trigger
--    WHERE tgrelid = 'public.emissoes_pacotes'::regclass AND NOT tgisinternal;
--
-- Nada foi bloqueado indevidamente — condomínios+mês com emissão registrada
-- convivendo com irmã não aprovada (deve dar 0 depois de hoje; linhas antigas
-- não são tocadas por esta migration):
--   SELECT condominio_id, mes_referencia, ano_referencia
--     FROM public.emissoes_pacotes
--    GROUP BY 1,2,3
--   HAVING count(*) FILTER (WHERE status IN ('registrado','expedida')) > 0
--      AND count(*) FILTER (WHERE status NOT IN ('aprovado','registrado','expedida')) > 0;

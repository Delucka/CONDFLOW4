-- ============================================================================
-- 0106 — A situação do condomínio é consequência do gerente
-- ============================================================================
--
-- A REGRA, em uma frase: o condomínio está na operação se, e somente se, está
-- vinculado a um gerente que está na operação.
--
--   gerente ativo    → condomínio ativo
--   gerente inativo  → condomínio a_entrar
--   sem gerente      → condomínio a_entrar
--
-- Por que virar derivado em vez de campo que alguém mantém: campo mantido à mão
-- diverge. Bastava alguém liberar o gerente e esquecer os condomínios, ou trocar
-- a carteira sem lembrar da situação, para o painel passar a mentir — e mentir
-- calado, que é o pior jeito. Do jeito abaixo não há o que esquecer: a única
-- coisa que se decide é quem está na operação, e o resto segue.
--
-- Isso também aposenta duas coisas que eu tinha construído: a aba "A entrar"
-- com o botão de habilitar um por um, e o trecho que trazia a carteira junto ao
-- liberar o gerente. As duas viravam uma segunda porta para a mesma decisão.
--
-- Efeito medido na base de hoje: 6 condomínios passam a ativo (os do Iago, que
-- já está liberado) e NENHUM sai de operação. Nenhum dos 66 que já emitiram é
-- desligado.
--
-- `encerrado` fica de fora da regra de propósito: quem saiu da administradora
-- não volta porque o gerente foi reativado. Essa é uma decisão de gente, e o
-- trigger não a desfaz.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.situacao_pelo_gerente(p_gerente_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
           WHEN p_gerente_id IS NULL THEN 'a_entrar'
           WHEN EXISTS (
             SELECT 1 FROM public.gerentes g
              WHERE g.id = p_gerente_id
                AND g.ativo IS TRUE
                AND (g.ativo_desde IS NULL OR g.ativo_desde <= CURRENT_DATE)
           ) THEN 'ativo'
           ELSE 'a_entrar'
         END;
$$;


-- ── Quando o condomínio muda de dono ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_condominio_situacao()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.situacao = 'encerrado' THEN
    RETURN NEW;
  END IF;
  NEW.situacao := public.situacao_pelo_gerente(NEW.gerente_id);
  IF TG_OP = 'UPDATE' AND NEW.situacao IS DISTINCT FROM OLD.situacao THEN
    NEW.situacao_desde := CURRENT_DATE;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_condominio_situacao ON public.condominios;
CREATE TRIGGER trg_condominio_situacao
  BEFORE INSERT OR UPDATE OF gerente_id, situacao ON public.condominios
  FOR EACH ROW EXECUTE FUNCTION public.tg_condominio_situacao();


-- ── Quando o gerente entra ou sai da operação ───────────────────────────────
-- A carteira inteira acompanha, no mesmo ato. É isto que substitui o "trazer os
-- condomínios junto" que estava no código da API.
CREATE OR REPLACE FUNCTION public.tg_gerente_situacao_carteira()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.ativo IS DISTINCT FROM OLD.ativo
     OR NEW.ativo_desde IS DISTINCT FROM OLD.ativo_desde THEN
    UPDATE public.condominios c
       SET situacao = public.situacao_pelo_gerente(NEW.id),
           situacao_desde = CURRENT_DATE
     WHERE c.gerente_id = NEW.id
       AND c.situacao <> 'encerrado'
       AND c.situacao IS DISTINCT FROM public.situacao_pelo_gerente(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_gerente_situacao_carteira ON public.gerentes;
CREATE TRIGGER trg_gerente_situacao_carteira
  AFTER UPDATE ON public.gerentes
  FOR EACH ROW EXECUTE FUNCTION public.tg_gerente_situacao_carteira();


-- ── Alinha o que já existe ──────────────────────────────────────────────────
UPDATE public.condominios c
   SET situacao = public.situacao_pelo_gerente(c.gerente_id),
       situacao_desde = CURRENT_DATE
 WHERE c.situacao <> 'encerrado'
   AND c.situacao IS DISTINCT FROM public.situacao_pelo_gerente(c.gerente_id);


-- ============================================================================
-- CONFERIR (rode depois)
-- ============================================================================
-- Deve dar zero linhas: nenhuma divergência entre a situação e a regra.
--
-- SELECT c.name, c.situacao, public.situacao_pelo_gerente(c.gerente_id) AS deveria
--   FROM condominios c
--  WHERE c.situacao <> 'encerrado'
--    AND c.situacao IS DISTINCT FROM public.situacao_pelo_gerente(c.gerente_id);
--
-- E a contagem por situação:
-- SELECT situacao, count(*) FROM condominios GROUP BY situacao ORDER BY 2 DESC;


-- ============================================================================
-- REVERTER
-- ============================================================================
-- DROP TRIGGER IF EXISTS trg_gerente_situacao_carteira ON public.gerentes;
-- DROP TRIGGER IF EXISTS trg_condominio_situacao ON public.condominios;
-- DROP FUNCTION IF EXISTS public.tg_gerente_situacao_carteira();
-- DROP FUNCTION IF EXISTS public.tg_condominio_situacao();
-- DROP FUNCTION IF EXISTS public.situacao_pelo_gerente(UUID);

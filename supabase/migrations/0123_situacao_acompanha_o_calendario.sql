-- ============================================================================
-- 0123 — A situação do condomínio passa a acompanhar o calendário
-- ============================================================================
--
-- A 0104 criou `gerentes.ativo_desde` com uma promessa escrita no comentário da
-- coluna:
--
--     "Serve para cadastrar quem começa no mês que vem."
--     "Ninguém precisa lembrar de voltar aqui no dia 1º."
--
-- A 0106 quebrou essa promessa sem querer. Ela derivou `condominios.situacao`
-- do gerente — o que está certo — mas GRAVOU o resultado numa coluna, e os dois
-- gatilhos que a mantêm só disparam em escrita:
--
--     BEFORE INSERT OR UPDATE OF gerente_id, situacao ON condominios
--     AFTER  UPDATE ON gerentes  (quando muda `ativo` ou `ativo_desde`)
--
-- Nenhum dos dois dispara porque "hoje virou dia 1º". A data chega, a regra
-- passa a dizer outra coisa, e a coluna continua com a resposta de ontem. O
-- condomínio só entra na operação se alguém, por acaso, editar aquele gerente
-- ou aquele condomínio depois da data.
--
-- É o que está acontecendo agora, medido em 09/09/2026:
--
--     Iago    ativo=true   ativo_desde=2026-10-01   7 condomínios
--
-- Os 7 estão `a_entrar` e somem do Painel Central — enquanto quatro planilhas
-- deles esperam liberação em Aprovações, com edição de outubro já finalizada.
-- E no dia 01/10 eles NÃO vão aparecer sozinhos: sem esta migration, alguém
-- teria de reabrir o cadastro do Iago e salvar de novo para destravar.
--
-- Ele é o único gerente com data futura hoje, mas a armadilha é da regra, não
-- dele: vale para o próximo que for cadastrado com data de entrada.
--
-- Duas correções, as duas pequenas:
--
-- 1. Um trabalho diário realinha a coluna com a regra. É o mesmo UPDATE que a
--    0106 já roda uma vez, agora repetido todo dia — a única entrada nova é a
--    passagem do tempo.
--
-- 2. A comparação de data passa a ser feita no fuso de São Paulo. O banco roda
--    em UTC, então das 21h à meia-noite daqui já é o dia seguinte lá: quem
--    começasse em 01/10 entraria na operação às 21h de 30/09. Três horas cedo
--    demais para uma data que a operação lê no calendário de parede.
--
-- Não mexe em quem está `encerrado`, não mexe na regra de quem é ativo, e não
-- muda nenhuma linha hoje (a base está alinhada; a divergência aparece no dia
-- 01/10). O que muda é que, a partir daqui, ela se resolve sozinha.
-- ============================================================================

-- ── 1) A regra, agora no fuso de quem usa ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.hoje_sp()
RETURNS DATE
LANGUAGE sql
STABLE
AS $$ SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date $$;

COMMENT ON FUNCTION public.hoje_sp() IS
  'A data de hoje em São Paulo. O banco roda em UTC: usar CURRENT_DATE faz o dia virar às 21h para quem está aqui.';

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
                AND (g.ativo_desde IS NULL OR g.ativo_desde <= public.hoje_sp())
           ) THEN 'ativo'
           ELSE 'a_entrar'
         END;
$$;

-- A mesma correção na view que a 0104 criou justamente para a condição não ser
-- repetida errado em cada consulta.
CREATE OR REPLACE VIEW public.gerentes_em_operacao AS
  SELECT *
    FROM public.gerentes
   WHERE ativo IS TRUE
     AND (ativo_desde IS NULL OR ativo_desde <= public.hoje_sp());


-- Os dois gatilhos da 0106 carimbam `situacao_desde` com `CURRENT_DATE`. Ficam
-- no mesmo fuso do resto, senão o carimbo de uma mudança feita às 22h de São
-- Paulo sai com a data de amanhã. O corpo deles não muda em mais nada.
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
    NEW.situacao_desde := public.hoje_sp();
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_gerente_situacao_carteira()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.ativo IS DISTINCT FROM OLD.ativo
     OR NEW.ativo_desde IS DISTINCT FROM OLD.ativo_desde THEN
    UPDATE public.condominios c
       SET situacao = public.situacao_pelo_gerente(NEW.id),
           situacao_desde = public.hoje_sp()
     WHERE c.gerente_id = NEW.id
       AND c.situacao <> 'encerrado'
       AND c.situacao IS DISTINCT FROM public.situacao_pelo_gerente(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;


-- ── 2) O realinhamento, que agora tem quem o chame todo dia ─────────────────
CREATE OR REPLACE FUNCTION public.alinhar_situacao_condominios()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n INTEGER;
BEGIN
  UPDATE public.condominios c
     SET situacao = public.situacao_pelo_gerente(c.gerente_id),
         situacao_desde = public.hoje_sp()
   WHERE c.situacao <> 'encerrado'
     AND c.situacao IS DISTINCT FROM public.situacao_pelo_gerente(c.gerente_id);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

COMMENT ON FUNCTION public.alinhar_situacao_condominios() IS
  'Realinha condominios.situacao com a regra da 0106. Roda todo dia pelo pg_cron: a passagem do tempo é a única entrada que os gatilhos não enxergam.';

-- Só quem administra. A função escreve na base inteira; não é para o navegador.
REVOKE ALL ON FUNCTION public.alinhar_situacao_condominios() FROM PUBLIC, anon, authenticated;


-- ── 3) O trabalho diário ────────────────────────────────────────────────────
-- 03:10 UTC = 00:10 em São Paulo. Roda logo depois da virada do dia daqui, que
-- é a data que a regra passa a usar. Já existe um job diário neste banco
-- (`limpar-notificacoes`, 04:00 UTC); este entra antes e não concorre com ele.
SELECT cron.unschedule('alinhar-situacao-condominios')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'alinhar-situacao-condominios');

SELECT cron.schedule(
  'alinhar-situacao-condominios',
  '10 3 * * *',
  $$ SELECT public.alinhar_situacao_condominios(); $$
);


-- ── 4) Alinha agora ─────────────────────────────────────────────────────────
-- Hoje deve devolver 0: a base está consistente com a regra, e o Iago só entra
-- em 01/10. Deixar aqui mesmo assim é de propósito — se alguém aplicar esta
-- migration depois daquela data, ela já corrige na hora.
SELECT public.alinhar_situacao_condominios() AS linhas_realinhadas;


-- ============================================================================
-- CONFERIR (rode depois)
-- ============================================================================
-- 1) O trabalho está agendado?
--    SELECT jobname, schedule, active FROM cron.job ORDER BY jobid;
--
-- 2) Nenhuma divergência entre a coluna e a regra:
--    SELECT c.name, c.situacao, public.situacao_pelo_gerente(c.gerente_id) AS deveria
--      FROM condominios c
--     WHERE c.situacao <> 'encerrado'
--       AND c.situacao IS DISTINCT FROM public.situacao_pelo_gerente(c.gerente_id);
--
-- 3) Quem tem data de entrada no futuro (é quem o trabalho diário vai destravar):
--    SELECT nome, ativo_desde, (SELECT count(*) FROM condominios WHERE gerente_id = g.id) AS carteira
--      FROM gerentes g WHERE ativo IS TRUE AND ativo_desde > public.hoje_sp();
--
-- 4) O ensaio do dia 01/10, sem esperar por ele — dentro de uma transação que
--    volta atrás no fim, então não altera nada:
--
--    BEGIN;
--      UPDATE gerentes SET ativo_desde = public.hoje_sp() WHERE nome = 'Iago';
--      SELECT public.alinhar_situacao_condominios();          -- espera-se 7
--      SELECT situacao, count(*) FROM condominios GROUP BY 1; -- 72 ativo / 253 a_entrar
--    ROLLBACK;
--
--    (Este ensaio passa pelo gatilho da 0106, que já realinha a carteira ao
--     mudar `ativo_desde`. Ele mede o resultado, não o caminho.)


-- ============================================================================
-- REVERTER
-- ============================================================================
-- SELECT cron.unschedule('alinhar-situacao-condominios');
-- DROP FUNCTION IF EXISTS public.alinhar_situacao_condominios();
-- -- e voltar situacao_pelo_gerente / gerentes_em_operacao para CURRENT_DATE,
-- -- como estavam na 0106 e na 0104.
-- DROP FUNCTION IF EXISTS public.hoje_sp();

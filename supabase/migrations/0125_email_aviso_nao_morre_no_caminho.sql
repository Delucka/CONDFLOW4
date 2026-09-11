-- ============================================================================
-- 0125 — O e-mail de aviso deixa de morrer no caminho
-- ============================================================================
--
-- SINTOMA: gerentes "não receberam o comunicado" da abertura do mês.
--
-- O aviso existe nos dois canais: o sino, dentro do sistema, e o e-mail. Os
-- quatro avisos de abertura de Outubro/2026 estão com `lida = false` até hoje,
-- 8 dias depois — ninguém abriu o sino. O canal que de fato chega ao gerente é
-- o e-mail. E o e-mail tinha um prazo curto demais para existir.
--
-- CAUSA: `enviar_email` chama `net.http_post` sem `timeout_milliseconds`, e o
-- padrão do pg_net é 5000 ms. Do outro lado está uma função da Vercel que, a
-- frio, ainda precisa subir o Python e abrir SMTP com o Gmail. Medido na janela
-- que o pg_net guarda (10/09/2026, 12h52 a 18h20 UTC):
--
--     15 respostas 200  ·  5 "Timeout of 5000 ms reached"  ·  0 erro HTTP
--
-- Um em cada quatro e-mails morria antes de a Vercel responder. E uma abertura
-- em massa é o pior caso: dispara um aviso por gerente de uma vez, as funções
-- sobem a frio em paralelo, e é exatamente aí que os 5 s estouram.
--
-- A falha é muda por construção: `EXCEPTION WHEN OTHERS THEN NULL` (correto —
-- aviso nunca pode derrubar o INSERT que o disparou) e o pg_net só guarda as
-- respostas por algumas horas. Ninguém via.
--
-- CONSERTO: 25 s de prazo. Folgado de propósito: a Vercel corta a função antes
-- disso, então o pg_net nunca mais desiste de um envio que ainda estava em
-- andamento — no pior caso ele registra o erro que a Vercel devolver, que é
-- informação, em vez de um timeout, que não é.
--
-- De quebra, `SET search_path = public`: função SECURITY DEFINER sem search_path
-- fixo é a porta clássica para alguém criar um objeto com o mesmo nome num
-- schema que vem antes e ser executado com os privilégios do dono. Todas as
-- referências aqui já são qualificadas (`public.app_config`, `net.http_post`),
-- então fixar o caminho não muda nada no comportamento — só fecha a porta.
--
-- O resto do corpo é idêntico ao que está no banco hoje, inclusive o segredo
-- lido de `app_config`, que não sai deste arquivo.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.enviar_email(p_to text, p_subject text, p_html text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE v_secret text;
BEGIN
  IF p_to IS NULL OR p_to = '' THEN RETURN; END IF;
  SELECT valor INTO v_secret FROM public.app_config WHERE chave = 'email_hook_secret';
  IF v_secret IS NULL OR v_secret = '' THEN RETURN; END IF;
  PERFORM net.http_post(
    url := 'https://emissaonline.com/api/notificacoes/email-hook',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-notif-secret', v_secret),
    body := jsonb_build_object('to', p_to, 'subject', p_subject, 'html', p_html),
    timeout_milliseconds := 25000
  );
EXCEPTION WHEN OTHERS THEN NULL;
END;
$function$;


-- ============================================================================
-- CONFERIR (rode depois)
-- ============================================================================
-- 1) O prazo novo está na função:
--    SELECT pg_get_functiondef('public.enviar_email'::regproc) ILIKE '%timeout_milliseconds := 25000%';
--
-- 2) Nas horas seguintes, nenhum timeout novo. O pg_net guarda algumas horas:
--    SELECT status_code, count(*),
--           count(*) FILTER (WHERE error_msg ILIKE '%timeout%') AS timeouts
--      FROM net._http_response
--     WHERE created > now() - interval '3 hours'
--     GROUP BY status_code;


-- ============================================================================
-- REVERTER
-- ============================================================================
-- Rodar de novo o CREATE OR REPLACE acima sem a linha `timeout_milliseconds`
-- e sem `SET search_path` — é exatamente como estava.

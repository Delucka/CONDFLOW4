-- ============================================================================
-- 0116 — O e-mail passa a sair (e a receber) pelo domínio próprio
-- ============================================================================
--
-- Existe agora uma caixa de verdade: condoflow@emissaonline.com. Duas coisas
-- no banco precisavam acompanhar.
--
-- 1) O GATILHO CHAMAVA O DOMÍNIO ANTIGO.
--    `enviar_email` (0050) faz POST em
--        https://condominios-gamma.vercel.app/api/notificacoes/email-hook
--    que hoje responde 308 — redirecionamento. Funciona por sorte: o pg_net
--    segue o redirecionamento e o e-mail sai. Mas todo aviso do sistema passa
--    por essa linha, e ela depende de um domínio que ninguém mais mantém. Vai
--    para o endereço atual.
--
-- 2) O RODAPÉ MANDAVA NÃO RESPONDER.
--    Era verdade enquanto o remetente era uma conta do Gmail que ninguém lia.
--    Com uma caixa própria, responder é justamente o que queremos: o síndico
--    responde o aviso e a resposta chega em condoflow@emissaonline.com.
--
-- O REMETENTE não é escolhido aqui. Ele vem do `SMTP_USER` do servidor — o
-- mesmo endereço que envia é o que recebe a resposta, sem precisar de Reply-To.
--
-- ROLLBACK: os corpos anteriores estão na 0050 (`enviar_email`) e na 0114
-- (`email_template`).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.enviar_email(p_to text, p_subject text, p_html text)
RETURNS void AS $$
DECLARE v_secret text;
BEGIN
  IF p_to IS NULL OR p_to = '' THEN RETURN; END IF;
  SELECT valor INTO v_secret FROM public.app_config WHERE chave = 'email_hook_secret';
  IF v_secret IS NULL OR v_secret = '' THEN RETURN; END IF;   -- e-mail desligado
  PERFORM net.http_post(
    url := 'https://emissaonline.com/api/notificacoes/email-hook',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-notif-secret', v_secret),
    body := jsonb_build_object('to', p_to, 'subject', p_subject, 'html', p_html)
  );
EXCEPTION WHEN OTHERS THEN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


CREATE OR REPLACE FUNCTION public.email_template(p_titulo text, p_mensagem text, p_link text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT
    '<meta name="color-scheme" content="light dark">'
    || '<meta name="supported-color-schemes" content="light dark">'
    || '<div style="background:#eef1f6;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;color-scheme:light dark;">'
    || '<div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e6ebf3;">'
    -- Cabeçalho claro: a marca vive na tipografia e no filete, não no fundo.
    || '<div style="background:#ffffff;padding:18px 24px 16px;">'
    ||   '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>'
    ||     '<td style="vertical-align:middle;width:44px;"><img src="https://emissaonline.com/email-logo.png" width="44" height="44" alt="" style="display:block;border-radius:12px;border:0;"></td>'
    ||     '<td style="vertical-align:middle;padding-left:12px;"><span style="font-size:19px;font-weight:bold;color:#142a63;">Condo<span style="color:#3b6fe0;">Flow</span></span></td>'
    ||     '<td style="vertical-align:middle;text-align:right;"><span style="font-size:10px;color:#7e8ba3;text-transform:uppercase;letter-spacing:1.5px;">Gestão de Condomínios</span></td>'
    ||   '</tr></table>'
    || '</div>'
    || '<div style="height:3px;background:#3b6fe0;font-size:0;line-height:0;">&nbsp;</div>'
    -- corpo
    || '<div style="padding:26px 28px 24px;">'
    ||   '<h2 style="margin:0 0 12px;color:#0f1a3c;font-size:20px;font-weight:bold;letter-spacing:-0.3px;">' || coalesce(p_titulo, 'Notificação') || '</h2>'
    ||   '<div style="color:#475569;font-size:15px;line-height:1.7;">' || coalesce(p_mensagem, '') || '</div>'
    ||   CASE WHEN p_link IS NOT NULL AND p_link <> '' THEN
           '<div style="margin-top:22px;"><a href="https://emissaonline.com' || p_link || '" style="display:inline-block;background:#142a63;color:#ffffff;font-size:15px;font-weight:bold;padding:13px 30px;border-radius:10px;text-decoration:none;border:1px solid #142a63;">Abrir no CondoFlow</a></div>'
         ELSE '' END
    || '</div>'
    -- rodapé corporativo
    || '<div style="padding:20px 28px;border-top:1px solid #eef2f7;background:#f8fafc;">'
    ||   '<p style="margin:0 0 8px;font-size:14px;font-weight:bold;color:#142a63;">Prop Starter <span style="font-weight:normal;color:#94a3b8;font-size:12px;">&middot; Qualidade e eficiência na gestão imobiliária</span></p>'
    ||   '<p style="margin:0 0 6px;font-size:12px;color:#475569;">(11) 3170-1999 &nbsp;&middot;&nbsp; <a href="https://www.propstarter.com.br" style="color:#1e3a8a;text-decoration:none;">www.propstarter.com.br</a></p>'
    ||   '<p style="margin:0 0 10px;font-size:12px;color:#64748b;">Rua do Paraíso, 596 — Paraíso, São Paulo &middot; SP</p>'
    ||   '<p style="margin:0;font-size:11px;color:#94a3b8;line-height:1.6;border-top:1px solid #eef2f7;padding-top:10px;">Aviso automático do CondoFlow — se precisar falar com a gente, é só responder este e-mail. O conteúdo desta mensagem e seus anexos é de uso exclusivo do destinatário e pode conter informações confidenciais; se você não é o destinatário, por favor desconsidere.</p>'
    || '</div>'
    || '</div></div>';
$$;


-- ============================================================================
-- CONFERIR (rode depois)
-- ============================================================================
-- O gatilho aponta para o domínio atual (deve vir 'ok'):
--   SELECT CASE WHEN prosrc LIKE '%emissaonline.com/api/notificacoes%'
--               AND prosrc NOT LIKE '%condominios-gamma%'
--               THEN 'ok' ELSE '>>> AINDA NO DOMÍNIO ANTIGO <<<' END AS veredito
--     FROM pg_proc WHERE proname = 'enviar_email';
--
-- O rodapé convida a responder (deve vir 'ok'):
--   SELECT CASE WHEN public.email_template('t','m','/dashboard') LIKE '%responder este e-mail%'
--               THEN 'ok' ELSE '>>> RODAPÉ ANTIGO <<<' END AS veredito;
--
-- O envio continua ligado (precisa existir e não ser vazio):
--   SELECT chave, (valor <> '') AS preenchido FROM public.app_config WHERE chave = 'email_hook_secret';

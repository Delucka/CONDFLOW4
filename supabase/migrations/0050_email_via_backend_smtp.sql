-- ==========================================
-- MIGRATION 0050: e-mail das notificações via backend (SMTP/Gmail)
-- Redefine enviar_email() para chamar o endpoint /api/notificacoes/email-hook
-- (que manda por SMTP). Chega em QUALQUER e-mail, sem domínio/DNS.
-- Fica DESLIGADO até existir 'email_hook_secret' em app_config.
-- ==========================================

CREATE OR REPLACE FUNCTION public.enviar_email(p_to text, p_subject text, p_html text)
RETURNS void AS $$
DECLARE v_secret text;
BEGIN
  IF p_to IS NULL OR p_to = '' THEN RETURN; END IF;
  SELECT valor INTO v_secret FROM public.app_config WHERE chave = 'email_hook_secret';
  IF v_secret IS NULL OR v_secret = '' THEN RETURN; END IF;   -- e-mail desligado
  PERFORM net.http_post(
    url := 'https://condominios-gamma.vercel.app/api/notificacoes/email-hook',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-notif-secret', v_secret),
    body := jsonb_build_object('to', p_to, 'subject', p_subject, 'html', p_html)
  );
EXCEPTION WHEN OTHERS THEN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

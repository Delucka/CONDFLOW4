-- ==========================================
-- MIGRATION 0049: E-mail das notificações (Resend via pg_net)
-- Toda notificação inserida dispara um e-mail ao destinatário.
-- Fica DESLIGADO até existir a chave em app_config (seguro rodar já).
-- ==========================================

CREATE EXTENSION IF NOT EXISTS pg_net;

-- Configuração privada (chave da API + remetente). RLS ligada e sem policy =
-- ninguém lê pelo cliente; só funções SECURITY DEFINER e o service role.
CREATE TABLE IF NOT EXISTS public.app_config (
  chave TEXT PRIMARY KEY,
  valor TEXT
);
ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

-- Envia e-mail via Resend. Sem chave -> não faz nada. Erros nunca quebram a transação.
CREATE OR REPLACE FUNCTION public.enviar_email(p_to text, p_subject text, p_html text)
RETURNS void AS $$
DECLARE v_key text; v_from text;
BEGIN
  IF p_to IS NULL OR p_to = '' THEN RETURN; END IF;
  SELECT valor INTO v_key  FROM public.app_config WHERE chave = 'resend_api_key';
  SELECT valor INTO v_from FROM public.app_config WHERE chave = 'email_from';
  IF v_key IS NULL OR v_key = '' THEN RETURN; END IF;   -- e-mail desligado
  PERFORM net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json'),
    body := jsonb_build_object(
      'from', coalesce(v_from, 'CondoFlow <onboarding@resend.dev>'),
      'to', jsonb_build_array(p_to),
      'subject', p_subject,
      'html', p_html
    )
  );
EXCEPTION WHEN OTHERS THEN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger: ao inserir uma notificação, manda e-mail pro destinatário
CREATE OR REPLACE FUNCTION public.email_da_notificacao()
RETURNS TRIGGER AS $$
DECLARE
  v_email text;
  v_base  text := 'https://condominios-gamma.vercel.app';
  v_html  text;
BEGIN
  SELECT email INTO v_email FROM public.profiles WHERE id = NEW.user_id;
  IF v_email IS NULL THEN RETURN NEW; END IF;
  v_html :=
    '<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto">'
    || '<div style="background:#6d28d9;color:#fff;padding:16px 20px;border-radius:12px 12px 0 0;font-weight:bold;font-size:16px">CONDOFLOW</div>'
    || '<div style="border:1px solid #e9edf2;border-top:none;border-radius:0 0 12px 12px;padding:20px">'
    || '<h2 style="margin:0 0 8px;color:#0f172a;font-size:18px">' || coalesce(NEW.titulo, 'Notificação') || '</h2>'
    || '<p style="color:#475569;font-size:14px;line-height:1.5">' || coalesce(NEW.mensagem, '') || '</p>'
    || '<a href="' || v_base || coalesce(NEW.link, '/dashboard')
    || '" style="display:inline-block;margin-top:12px;background:#6d28d9;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:bold;font-size:14px">Abrir no sistema</a>'
    || '</div></div>';
  PERFORM public.enviar_email(v_email, '🔔 ' || coalesce(NEW.titulo, 'Notificação CondoFlow'), v_html);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_email_notif ON public.notificacoes;
CREATE TRIGGER trg_email_notif
  AFTER INSERT ON public.notificacoes
  FOR EACH ROW EXECUTE FUNCTION public.email_da_notificacao();

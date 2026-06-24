-- ==========================================
-- MIGRATION 0059: Template de e-mail com o pinguim porteiro (visual profissional)
-- Centraliza o HTML num único public.email_template(titulo, mensagem, link):
--   cabeçalho navy + GIF animado do pinguim, corpo com título/mensagem, botão e rodapé.
-- Reescreve email_da_notificacao() (principal) e notificar_emissao() (gerentes sem login)
-- para usar o template. O GIF é servido em /email-penguin.gif (público).
-- ==========================================

CREATE OR REPLACE FUNCTION public.email_template(p_titulo text, p_mensagem text, p_link text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT
    '<div style="background:#eef1f6;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;">'
    || '<div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e6ebf3;">'
    -- cabeçalho navy + pinguim
    || '<div style="background:#142a63;padding:18px 24px;">'
    ||   '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>'
    ||     '<td style="vertical-align:middle;"><img src="https://condominios-gamma.vercel.app/email-penguin.gif" width="48" height="48" alt="CondoFlow" style="display:block;border-radius:14px;border:0;"></td>'
    ||     '<td style="vertical-align:middle;padding-left:13px;"><span style="font-size:19px;font-weight:bold;color:#ffffff;">Condo<span style="color:#9db8ef;">Flow</span></span></td>'
    ||   '</tr></table>'
    || '</div>'
    || '<div style="height:3px;background:#3b6fe0;font-size:0;line-height:0;">&nbsp;</div>'
    -- corpo
    || '<div style="padding:28px 28px 26px;">'
    ||   '<h2 style="margin:0 0 10px;color:#0f1a3c;font-size:20px;font-weight:bold;letter-spacing:-0.3px;">' || coalesce(p_titulo, 'Notificação') || '</h2>'
    ||   '<p style="margin:0 0 22px;color:#475569;font-size:15px;line-height:1.7;">' || coalesce(p_mensagem, '') || '</p>'
    ||   CASE WHEN p_link IS NOT NULL AND p_link <> '' THEN
           '<a href="https://condominios-gamma.vercel.app' || p_link || '" style="display:inline-block;background:#142a63;color:#ffffff;font-size:15px;font-weight:bold;padding:13px 30px;border-radius:10px;text-decoration:none;">Abrir no CondoFlow</a>'
         ELSE '' END
    || '</div>'
    -- rodapé
    || '<div style="padding:18px 28px;border-top:1px solid #eef2f7;background:#f8fafc;">'
    ||   '<p style="margin:0 0 4px;color:#475569;font-size:13px;font-weight:bold;">CondoFlow &middot; Sistema de Gestão de Condomínios</p>'
    ||   '<p style="margin:0;color:#94a3b8;font-size:12px;line-height:1.6;">Mensagem automática enviada porque você tem notificações ativas. Para ajustar, acesse seu perfil no sistema.</p>'
    || '</div>'
    || '</div></div>';
$$;

-- Trigger principal: toda notificação vira e-mail com o template
CREATE OR REPLACE FUNCTION public.email_da_notificacao()
RETURNS TRIGGER AS $$
DECLARE
  v_email text;
BEGIN
  SELECT coalesce(
    (SELECT g.notificacao_email FROM public.gerentes g
       WHERE g.profile_id = NEW.user_id
         AND g.notificacao_email IS NOT NULL AND g.notificacao_email <> '' LIMIT 1),
    (SELECT p.notificacao_email FROM public.profiles p
       WHERE p.id = NEW.user_id
         AND p.notificacao_email IS NOT NULL AND p.notificacao_email <> ''),
    (SELECT email FROM public.profiles WHERE id = NEW.user_id)
  ) INTO v_email;

  IF v_email IS NULL OR v_email = '' THEN RETURN NEW; END IF;

  PERFORM public.enviar_email(
    v_email,
    coalesce(NEW.titulo, 'Notificação CondoFlow'),
    public.email_template(NEW.titulo, NEW.mensagem, coalesce(NEW.link, '/dashboard'))
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Gerentes SEM login: e-mail direto também com o template
CREATE OR REPLACE FUNCTION public.notificar_emissao()
RETURNS TRIGGER AS $$
DECLARE
  st         text := lower(coalesce(NEW.status, ''));
  condo_nome text;
  periodo    text := lpad(coalesce(NEW.mes_referencia, 0)::text, 2, '0') || '/' || coalesce(NEW.ano_referencia, 0)::text;
BEGIN
  IF TG_OP = 'UPDATE' AND coalesce(OLD.status, '') = coalesce(NEW.status, '') THEN
    RETURN NEW;
  END IF;

  SELECT name INTO condo_nome FROM public.condominios WHERE id = NEW.condominio_id;
  condo_nome := coalesce(condo_nome, 'Condomínio');

  IF st LIKE '%aguardando gerente%' OR st = 'pendente_gerente' THEN
    INSERT INTO public.notificacoes (user_id, tipo, titulo, mensagem, link)
    SELECT g.profile_id, 'emissao_aprovacao',
           'Emissão aguardando sua aprovação',
           condo_nome || ' · ' || periodo || ' — precisa da sua conferência.',
           '/aprovacoes'
    FROM public.condominios c JOIN public.gerentes g ON c.gerente_id = g.id
    WHERE c.id = NEW.condominio_id AND g.profile_id IS NOT NULL;

    PERFORM public.enviar_email(
      g.notificacao_email,
      'Emissão aguardando aprovação',
      public.email_template(
        'Emissão aguardando aprovação',
        condo_nome || ' &middot; ' || periodo || ' — precisa da sua conferência.',
        '/aprovacoes'
      )
    )
    FROM public.condominios c JOIN public.gerentes g ON c.gerente_id = g.id
    WHERE c.id = NEW.condominio_id AND g.profile_id IS NULL
      AND g.notificacao_email IS NOT NULL AND g.notificacao_email <> '';

  ELSIF st LIKE '%aguardando supervisor%' OR st LIKE 'pendente_sup%' OR st LIKE '%supervisor%' OR st LIKE '%chefe%' THEN
    INSERT INTO public.notificacoes (user_id, tipo, titulo, mensagem, link)
    SELECT p.id, 'emissao_aprovacao',
           'Emissão aguardando aprovação',
           condo_nome || ' · ' || periodo || ' — pendente de aprovação.',
           '/aprovacoes'
    FROM public.profiles p
    WHERE p.role IN ('supervisora', 'supervisora_contabilidade', 'supervisor_gerentes');

  ELSIF st = 'solicitar_correcao' THEN
    INSERT INTO public.notificacoes (user_id, tipo, titulo, mensagem, link)
    SELECT p.id, 'emissao_correcao',
           'Correção solicitada',
           condo_nome || ' · ' || periodo || ' — a emissão precisa de ajustes e reenvio.',
           '/central-emissoes'
    FROM public.profiles p
    WHERE (NEW.uploaded_by IS NOT NULL AND p.id = NEW.uploaded_by)
       OR (NEW.uploaded_by IS NULL AND p.role IN ('master', 'departamento'));

  ELSIF st = 'aprovado' OR st = 'registrado' THEN
    INSERT INTO public.notificacoes (user_id, tipo, titulo, mensagem, link)
    SELECT p.id,
           CASE WHEN st = 'registrado' THEN 'emissao_registrada' ELSE 'emissao_aprovada' END,
           CASE WHEN st = 'registrado' THEN 'Emissão registrada' ELSE 'Emissão aprovada' END,
           condo_nome || ' · ' || periodo || (CASE WHEN st = 'registrado' THEN ' — registro concluído.' ELSE ' — aprovada, pode prosseguir.' END),
           '/central-emissoes'
    FROM public.profiles p
    WHERE (NEW.uploaded_by IS NOT NULL AND p.id = NEW.uploaded_by)
       OR (NEW.uploaded_by IS NULL AND p.role IN ('master', 'departamento'));
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

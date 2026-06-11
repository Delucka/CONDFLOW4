-- ==========================================
-- MIGRATION 0051: E-mail de notificação configurável para TODOS (emissor → supervisores)
-- - profiles.notificacao_email: para qualquer usuário com login (emissor, gerente, supervisor...)
-- - gerentes.notificacao_email : para gerentes SEM login (fantasma/demo)
-- O e-mail de cada notificação prefere: gerente.notificacao_email -> profile.notificacao_email -> profile.email
-- ==========================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS notificacao_email TEXT;

ALTER TABLE public.gerentes
  ADD COLUMN IF NOT EXISTS notificacao_email TEXT;

CREATE OR REPLACE FUNCTION public.email_da_notificacao()
RETURNS TRIGGER AS $$
DECLARE
  v_email text;
  v_base  text := 'https://condominios-gamma.vercel.app';
  v_html  text;
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

  v_html :=
    '<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto">'
    || '<div style="background:#6d28d9;color:#fff;padding:16px 20px;border-radius:12px 12px 0 0;font-weight:bold">CONDOFLOW</div>'
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

-- "Aguardando Gerente": in-app pra quem tem login + e-mail direto pros gerentes SEM login
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
      '🔔 Emissão aguardando aprovação',
      '<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto"><div style="background:#6d28d9;color:#fff;padding:16px 20px;border-radius:12px 12px 0 0;font-weight:bold">CONDOFLOW</div><div style="border:1px solid #e9edf2;border-top:none;border-radius:0 0 12px 12px;padding:20px"><h2 style="margin:0 0 8px;color:#0f172a;font-size:18px">Emissão aguardando aprovação</h2><p style="color:#475569;font-size:14px">'
        || condo_nome || ' · ' || periodo || ' — precisa da sua conferência.</p></div></div>'
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

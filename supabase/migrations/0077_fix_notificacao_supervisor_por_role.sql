-- ==========================================
-- MIGRATION 0077: Corrige o alvo das notificações de emissão por SUPERVISOR
-- Bug: o ramo de supervisor do trigger notificar_emissao() disparava para os TRÊS
-- supervisores em qualquer 'pendente_sup%' — então o supervisor de gerentes recebia
-- aviso do que é da contabilidade (e vice-versa). Agora roteia pelo status específico,
-- batendo com aprovacaoFluxo.js/usePendingCount (front):
--   pendente_sup_gerentes / 'chefe' / 'sup. gerentes'  -> só supervisor_gerentes
--   pendente_sup_contabilidade / 'supervisor…'         -> só supervisora + supervisora_contabilidade
-- Só a função muda (CREATE OR REPLACE); o trigger existente passa a usar esta versão.
-- Reversível: reaplicar a função da 0051.
-- ==========================================

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

  -- Supervisor de GERENTES (só ele) — status específico dele
  ELSIF st = 'pendente_sup_gerentes' OR st LIKE '%sup. gerentes%' OR st LIKE '%sup gerentes%' OR st LIKE '%chefe%' THEN
    INSERT INTO public.notificacoes (user_id, tipo, titulo, mensagem, link)
    SELECT p.id, 'emissao_aprovacao',
           'Emissão aguardando aprovação',
           condo_nome || ' · ' || periodo || ' — pendente da sua aprovação.',
           '/aprovacoes'
    FROM public.profiles p
    WHERE p.role = 'supervisor_gerentes';

  -- Supervisor de CONTABILIDADE (contabilidade + 'supervisora' que conta como contabilidade)
  ELSIF st = 'pendente_sup_contabilidade' OR st LIKE '%aguardando supervisor%' OR st LIKE 'pendente_sup%' OR st LIKE '%supervisor%' THEN
    INSERT INTO public.notificacoes (user_id, tipo, titulo, mensagem, link)
    SELECT p.id, 'emissao_aprovacao',
           'Emissão aguardando aprovação',
           condo_nome || ' · ' || periodo || ' — pendente da sua aprovação.',
           '/aprovacoes'
    FROM public.profiles p
    WHERE p.role IN ('supervisora', 'supervisora_contabilidade');

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

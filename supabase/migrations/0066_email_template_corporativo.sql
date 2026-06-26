-- ==========================================
-- MIGRATION 0066: Template de e-mail com rodapé corporativo (Prop Starter)
-- Atualiza public.email_template (usado por TODOS os e-mails): mantém o cabeçalho
-- navy + pinguim e troca o rodapé pela assinatura da empresa + aviso de sigilo.
-- ==========================================

CREATE OR REPLACE FUNCTION public.email_template(p_titulo text, p_mensagem text, p_link text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT
    '<div style="background:#eef1f6;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;">'
    || '<div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e6ebf3;">'
    -- cabeçalho navy + pinguim
    || '<div style="background:#142a63;padding:18px 24px;">'
    ||   '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>'
    ||     '<td style="vertical-align:middle;width:48px;"><img src="https://condominios-gamma.vercel.app/email-penguin.gif" width="48" height="48" alt="" style="display:block;border-radius:14px;border:0;"></td>'
    ||     '<td style="vertical-align:middle;padding-left:13px;"><span style="font-size:19px;font-weight:bold;color:#ffffff;">Condo<span style="color:#9db8ef;">Flow</span></span></td>'
    ||     '<td style="vertical-align:middle;text-align:right;"><span style="font-size:10px;color:#9db8ef;text-transform:uppercase;letter-spacing:1.5px;">Gestão de Condomínios</span></td>'
    ||   '</tr></table>'
    || '</div>'
    || '<div style="height:3px;background:#3b6fe0;font-size:0;line-height:0;">&nbsp;</div>'
    -- corpo
    || '<div style="padding:28px 28px 26px;">'
    ||   '<h2 style="margin:0 0 12px;color:#0f1a3c;font-size:20px;font-weight:bold;letter-spacing:-0.3px;">' || coalesce(p_titulo, 'Notificação') || '</h2>'
    ||   '<div style="color:#475569;font-size:15px;line-height:1.7;">' || coalesce(p_mensagem, '') || '</div>'
    ||   CASE WHEN p_link IS NOT NULL AND p_link <> '' THEN
           '<div style="margin-top:22px;"><a href="https://condominios-gamma.vercel.app' || p_link || '" style="display:inline-block;background:#142a63;color:#ffffff;font-size:15px;font-weight:bold;padding:13px 30px;border-radius:10px;text-decoration:none;">Abrir no CondoFlow</a></div>'
         ELSE '' END
    || '</div>'
    -- rodapé corporativo
    || '<div style="padding:20px 28px;border-top:1px solid #eef2f7;background:#f8fafc;">'
    ||   '<p style="margin:0 0 8px;font-size:14px;font-weight:bold;color:#142a63;">Prop Starter <span style="font-weight:normal;color:#94a3b8;font-size:12px;">&middot; Qualidade e eficiência na gestão imobiliária</span></p>'
    ||   '<p style="margin:0 0 6px;font-size:12px;color:#475569;">(11) 3170-1999 &nbsp;&middot;&nbsp; <a href="https://www.propstarter.com.br" style="color:#1e3a8a;text-decoration:none;">www.propstarter.com.br</a></p>'
    ||   '<p style="margin:0 0 10px;font-size:12px;color:#64748b;">Rua do Paraíso, 596 — Paraíso, São Paulo &middot; SP</p>'
    ||   '<p style="margin:0;font-size:11px;color:#94a3b8;line-height:1.6;border-top:1px solid #eef2f7;padding-top:10px;">Mensagem automática — favor não responder este endereço. O conteúdo desta mensagem e seus anexos é de uso exclusivo do destinatário e pode conter informações confidenciais; se você não é o destinatário, por favor desconsidere.</p>'
    || '</div>'
    || '</div></div>';
$$;

-- ============================================================================
-- 0114 — O e-mail aguenta o modo escuro
-- ============================================================================
--
-- O template (0079) foi desenhado só para fundo claro: faixa navy #142a63 no
-- topo, cartão branco, botão navy. No Gmail do celular em modo escuro, o
-- aplicativo INVERTE isso por conta própria — e o resultado é o que apareceu
-- na tela: faixa lilás pálida, cartão preto, botão lilás. Não é cor errada
-- escolhida por alguém; é a nossa cor invertida por um cliente de e-mail.
--
-- Não dá para proibir. O Gmail do Android ignora `color-scheme` e inverte
-- assim mesmo. O que dá é DESENHAR PARA A INVERSÃO — escolher elementos que
-- continuam certos quando trocam de lado:
--
--   antes: faixa navy + letras brancas   →  invertido: faixa lilás + letras escuras
--   agora: faixa branca + letras navy    →  invertido: faixa escura + letras claras
--
-- A marca sai da cor de fundo e vai para a tipografia e para o filete azul de
-- 3px, que é fino demais para o inversor estragar. Em claro fica um cabeçalho
-- branco com "CondoFlow" navy; em escuro, um cabeçalho escuro com "CondoFlow"
-- claro. Os dois parecem propositais, que é o máximo honesto aqui.
--
-- `color-scheme: light dark` entra no comando: Apple Mail, Outlook e o Gmail
-- da web respeitam e param de inverter. Só o aplicativo do Gmail insiste — e
-- para ele existe o desenho acima.
--
-- O corpo continua branco: invertido vira preto, com o texto claro, que é o
-- que já acontecia e estava legível. O que estava feio era o topo.
--
-- ROLLBACK: o corpo anterior está em 0079. Rodar aquele CREATE OR REPLACE
-- devolve a faixa navy — e a inversão junto.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.email_template(p_titulo text, p_mensagem text, p_link text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT
    -- Declara os dois esquemas: quem respeita, para de inverter.
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
    ||   '<p style="margin:0;font-size:11px;color:#94a3b8;line-height:1.6;border-top:1px solid #eef2f7;padding-top:10px;">Mensagem automática — favor não responder este endereço. O conteúdo desta mensagem e seus anexos é de uso exclusivo do destinatário e pode conter informações confidenciais; se você não é o destinatário, por favor desconsidere.</p>'
    || '</div>'
    || '</div></div>';
$$;


-- ============================================================================
-- CONFERIR (rode depois)
-- ============================================================================
-- O cabeçalho não é mais uma faixa navy (deve vir 'ok'):
--   SELECT CASE WHEN public.email_template('t','m','/dashboard') LIKE '%background:#142a63;padding:18px%'
--               THEN '>>> AINDA COM A FAIXA NAVY <<<' ELSE 'ok' END AS veredito;
--
-- Para ver o resultado sem esperar notificação, mande um e-mail de teste pelo
-- app (recuperação de senha) ou olhe o HTML cru:
--   SELECT public.email_template('Teste', '<p>corpo</p>', '/dashboard');

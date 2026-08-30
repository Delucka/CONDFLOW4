-- ============================================================================
-- RODAR PENDENTES — 0113 · 0114   (nesta ordem)
-- ============================================================================
--
-- Cole tudo de uma vez no SQL Editor do Supabase e rode.
--
-- JÁ CONFERIDO NO BANCO — não precisam ser rodadas de novo, e não estão aqui:
--
--   0103  policies novas criadas, nenhuma aberta
--   0107  rateios_valores.atualizado_em existe
--   0109  notificacoes.email_html existe
--   0110  condominios.usa_filipeta existe · categoria aceita 'filipeta'
--   0111  emissoes_pacotes.entregue_em / entregue_por_nome / recebido_por
--   0112  enum user_role aceita 'expedicao'
--
-- O QUE FALTA:
--
--   0113  É A IMPORTANTE. O lacre do pacote recusava anexar boleto, e o modal
--         "Expedir" só existe depois do registro — que é o que lacra. Ou seja,
--         anexar boleto nunca funcionou: o arquivo ia para o bucket e a linha
--         na tabela nunca era criada. Conferido: 0 boletos na base, 0 baixas de
--         impressão, 142 pacotes lacrados. Sem esta, nada da expedição anda.
--
--   0114  O e-mail no modo escuro do Gmail. A faixa navy do topo virava lilás
--         pálida — é o aplicativo invertendo um template feito só para fundo
--         claro. Não quebra nada; é aparência.
--
-- As duas são re-executáveis (CREATE OR REPLACE): rodar duas vezes não quebra.
--
-- No fim tem um bloco CONFERIR. Rode ele depois e olhe a coluna `veredito`.
-- ============================================================================


-- ==========================================================================
-- ↓↓↓ 0113_lacre_deixa_a_expedicao_trabalhar.sql — DESTRAVA o anexo do boleto
-- ==========================================================================

-- ============================================================================
-- 0113 — O lacre bloqueava o próprio trabalho da expedição
-- ============================================================================
--
-- Descoberto em 30/08/2026, tentando registrar um boleto que já estava no
-- bucket desde as 22:14:
--
--   P0001: Não é possível modificar arquivos de pacote lacrado.
--
-- A sequência que ninguém tinha juntado:
--
--   1. `lacra_ao_registrar` (0016) marca `lacrada = true` quando a emissão vira
--      'registrado'.
--   2. O modal "Expedir" só aparece DEPOIS do registro — é ali que se anexa o
--      boleto.
--   3. `protege_arquivos_lacrados` (0016) recusa QUALQUER insert, update ou
--      delete em `emissoes_arquivos` de pacote lacrado.
--
-- Ou seja: o passo 2 sempre foi impossível. O arquivo subia para o bucket (o
-- storage não tem esse gatilho) e a linha nunca era criada. O erro voltava e a
-- tela dizia "erro ao subir", sem explicar o quê.
--
-- Conferido no banco antes de escrever esta migration:
--
--   categorias em uso: emissao 257 · outros 235 · concessionaria 73 ·
--                      relatorio_leitura 26 · boleto ZERO
--   arquivos com baixa de impressão: ZERO
--   pacotes lacrados: 142
--
-- Nenhum boleto jamais chegou à tabela. A fila de expedição, a baixa de
-- impressão (0094), a filipeta (0110) e a entrega (0111) foram construídas
-- sobre uma porta fechada.
--
-- A 0095 investigou este mesmo sintoma e achou OUTRA causa — o insert mandava
-- `status: 'expedida'`, valor que o enum recusa. Aquilo era real e foi
-- corrigido; este gatilho estava atrás, e continuou barrando.
--
-- ---- O que muda ----
-- O lacre protege o que a EMISSÃO produziu: planilha, faturas, relatório de
-- rateio. O boleto e a filipeta são o que a EXPEDIÇÃO produz, e nascem depois
-- do lacre por definição. Lacrar contra eles não protege nada — só impede o
-- passo seguinte do processo.
--
-- Continua barrado, em pacote lacrado:
--   • inserir/alterar/apagar qualquer documento da emissão
--   • trocar o arquivo, o nome ou o pacote de um boleto já registrado
--
-- Passa a ser permitido:
--   • anexar boleto e filipeta
--   • carimbar a baixa de impressão neles (0094)
--   • apagar um boleto ou filipeta — subir o arquivo errado acontece, e sem
--     isso a correção seria pedir retificação da emissão inteira
--
-- ROLLBACK: o corpo antigo está em 0016_migrate_lacre_emissoes.sql, função
-- `protege_arquivos_lacrados`. Rodar aquele trecho volta ao comportamento
-- anterior — e volta a impedir a expedição de trabalhar.
-- ============================================================================

CREATE OR REPLACE FUNCTION protege_arquivos_lacrados()
RETURNS TRIGGER AS $$
DECLARE
  pacote_lacrado BOOLEAN;
  cat            TEXT;
BEGIN
  SELECT lacrada INTO pacote_lacrado
    FROM emissoes_pacotes
   WHERE id = COALESCE(NEW.pacote_id, OLD.pacote_id);

  IF pacote_lacrado IS NOT TRUE THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  cat := COALESCE(NEW.categoria, OLD.categoria);

  -- Saída 1 — anexar o que a expedição produz.
  IF TG_OP = 'INSERT' AND cat IN ('boleto', 'filipeta') THEN
    RETURN NEW;
  END IF;

  -- Saída 2 — carimbar a baixa de impressão. Só carimbo: se o arquivo, o nome,
  -- a categoria ou o pacote mudarem, isso não é baixa, é troca de conteúdo, e
  -- volta a cair no lacre.
  IF TG_OP = 'UPDATE'
     AND OLD.categoria IN ('boleto', 'filipeta')
     AND NEW.categoria   IS NOT DISTINCT FROM OLD.categoria
     AND NEW.pacote_id   IS NOT DISTINCT FROM OLD.pacote_id
     AND NEW.arquivo_url IS NOT DISTINCT FROM OLD.arquivo_url
     AND NEW.arquivo_nome IS NOT DISTINCT FROM OLD.arquivo_nome THEN
    RETURN NEW;
  END IF;

  -- Saída 3 — tirar um boleto ou filipeta anexado por engano.
  IF TG_OP = 'DELETE' AND cat IN ('boleto', 'filipeta') THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'Não é possível modificar arquivos de pacote lacrado.';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================================
-- CONFERIR (rode depois)
-- ============================================================================
-- O gatilho continua no lugar (1 linha):
--   SELECT tgname FROM pg_trigger WHERE tgname = 'trg_protege_arquivos';
--
-- A partir daqui, boleto anexado pelo "Expedir" aparece aqui (0 até agora):
--   SELECT count(*) FROM emissoes_arquivos WHERE categoria IN ('boleto','filipeta');
--
-- E o lacre continua valendo para a emissão — isto DEVE dar erro:
--   UPDATE emissoes_arquivos SET arquivo_nome = arquivo_nome || ' (teste)'
--    WHERE categoria = 'emissao'
--      AND pacote_id IN (SELECT id FROM emissoes_pacotes WHERE lacrada) LIMIT 1;


-- ==========================================================================
-- ↓↓↓ 0114_email_aguenta_modo_escuro.sql — Cor do e-mail no modo escuro
-- ==========================================================================

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




-- ============================================================================
-- CONFERIR — rode este bloco DEPOIS. Tudo tem de vir 'ok'.
-- ============================================================================

SELECT '0113 · lacre deixa passar boleto' AS item,
       CASE WHEN prosrc LIKE '%boleto%' AND prosrc LIKE '%filipeta%'
            THEN 'ok' ELSE '>>> FALTA <<<' END AS veredito
  FROM pg_proc WHERE proname = 'protege_arquivos_lacrados'
UNION ALL
SELECT '0113 · gatilho continua no lugar',
       CASE WHEN count(*) = 1 THEN 'ok' ELSE '>>> FALTA <<<' END
  FROM pg_trigger WHERE tgname = 'trg_protege_arquivos'
UNION ALL
SELECT '0114 · e-mail sem a faixa navy',
       CASE WHEN public.email_template('t', 'm', '/dashboard') LIKE '%background:#142a63;padding:18px%'
            THEN '>>> AINDA COM A FAIXA <<<' ELSE 'ok' END;


-- ============================================================================
-- DEPOIS DE RODAR
-- ============================================================================
-- Boleto anexado pelo "Expedir" passa a aparecer aqui (0 até agora):
--   SELECT count(*) FROM emissoes_arquivos WHERE categoria IN ('boleto','filipeta');
--
-- E o lacre continua valendo para a emissão — isto DEVE dar erro:
--   UPDATE emissoes_arquivos SET arquivo_nome = arquivo_nome || ' (teste)'
--    WHERE id = (SELECT a.id FROM emissoes_arquivos a
--                  JOIN emissoes_pacotes p ON p.id = a.pacote_id
--                 WHERE a.categoria = 'emissao' AND p.lacrada LIMIT 1);

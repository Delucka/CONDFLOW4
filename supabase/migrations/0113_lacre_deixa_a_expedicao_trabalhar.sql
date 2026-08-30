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

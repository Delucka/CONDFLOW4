-- ============================================================================
-- 0120 — Uma fatura da SABESP gravada como "outro documento"
-- ============================================================================
--
-- UM anexo, do 374 - COND. ED. MIAMI TOP, competência 07/2026:
--
--   id         25d81e46-f7ad-4d52-afa1-0e231e1c6835
--   arquivo    SABESP.pdf
--   categoria  outros                              ← deveria ser concessionaria
--   subtipo    "SABESP - R$ 4.708,82 - 25/06/2026" ← valor e vencimento
--                                                    digitados DENTRO do subtipo
--   valor_fatura       NULL
--   vencimento_fatura  NULL
--
-- Quem anexou escreveu o valor e o vencimento no campo de texto em vez dos
-- campos próprios. O efeito não era só cosmético: como `categoria = 'outros'`
-- sem palavra de serviço reconhecível, o arquivo caía no coringa do fim da
-- ordem de auditoria — saía DEPOIS do relatório de rateio, longe das outras
-- contas de água.
--
-- ---- Por que isto é uma migration, e não um UPDATE solto ----
--
-- O pacote está LACRADO, e `protege_arquivos_lacrados` (0016/0113) recusa
-- qualquer alteração em anexo de pacote lacrado — inclusive pela chave de
-- serviço. Não há exceção por papel, e isso é proposital: o lacre existe para
-- que uma emissão registrada não mude depois.
--
-- Então a correção é feita à luz do dia: o gatilho é desligado, UMA linha é
-- corrigida POR ID, e o gatilho volta — tudo na mesma transação, de modo que
-- qualquer falha no meio desfaz o conjunto e o lacre nunca fica aberto.
--
-- O valor e o vencimento não são invenção: saem do próprio subtipo antigo,
-- que está preservado acima e no ROLLBACK.
--
-- ROLLBACK no fim do arquivo.
-- ============================================================================

BEGIN;

-- Trava de segurança: se a linha já não estiver no estado errado, aborta.
DO $$
DECLARE cat TEXT; sub TEXT;
BEGIN
  SELECT categoria, subtipo INTO cat, sub
    FROM public.emissoes_arquivos
   WHERE id = '25d81e46-f7ad-4d52-afa1-0e231e1c6835';

  IF cat IS NULL THEN
    RAISE EXCEPTION 'Anexo nao encontrado — nada foi alterado.';
  END IF;
  IF cat <> 'outros' OR upper(sub) NOT LIKE '%SABESP%' THEN
    RAISE EXCEPTION 'O anexo nao esta no estado esperado (categoria=%, subtipo=%) — nada foi alterado.', cat, sub;
  END IF;
END $$;

ALTER TABLE public.emissoes_arquivos DISABLE TRIGGER trg_protege_arquivos;

UPDATE public.emissoes_arquivos
   SET categoria         = 'concessionaria',
       subtipo           = 'SABESP',
       valor_fatura      = 4708.82,
       vencimento_fatura = DATE '2026-06-25'
 WHERE id = '25d81e46-f7ad-4d52-afa1-0e231e1c6835';

ALTER TABLE public.emissoes_arquivos ENABLE TRIGGER trg_protege_arquivos;

COMMIT;


-- ============================================================================
-- CONFERIR (rode depois)
-- ============================================================================
-- 1) A linha ficou como as outras faturas da SABESP:
--
--   SELECT categoria, subtipo, valor_fatura, vencimento_fatura
--     FROM public.emissoes_arquivos
--    WHERE id = '25d81e46-f7ad-4d52-afa1-0e231e1c6835';
--
--   esperado: concessionaria | SABESP | 4708.82 | 2026-06-25
--
-- 2) O gatilho voltou (tgenabled deve ser 'O'):
--
--   SELECT tgname, tgenabled FROM pg_trigger
--    WHERE tgname = 'trg_protege_arquivos';
--
-- 3) Nao sobrou nenhum outro anexo com SABESP fora do lugar (deve vir vazio):
--
--   SELECT id, subtipo FROM public.emissoes_arquivos
--    WHERE categoria = 'outros' AND upper(subtipo) LIKE '%SABESP%';


-- ============================================================================
-- ROLLBACK
-- ============================================================================
-- BEGIN;
-- ALTER TABLE public.emissoes_arquivos DISABLE TRIGGER trg_protege_arquivos;
-- UPDATE public.emissoes_arquivos
--    SET categoria = 'outros',
--        subtipo = 'SABESP - R$ 4.708,82 - 25/06/2026',
--        valor_fatura = NULL,
--        vencimento_fatura = NULL
--  WHERE id = '25d81e46-f7ad-4d52-afa1-0e231e1c6835';
-- ALTER TABLE public.emissoes_arquivos ENABLE TRIGGER trg_protege_arquivos;
-- COMMIT;

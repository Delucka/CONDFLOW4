-- ==========================================
-- MIGRATION 0058: corrige o ON CONFLICT do trigger de concessionária
--
-- Bug: ao subir QUALQUER fatura de concessionária (SABESP/COMGÁS/ENEL) dava
--   "there is no unique or exclusion constraint matching the ON CONFLICT specification"
--   (Postgres 42P10) e o upload falhava inteiro.
--
-- Causa: a migration 0055 (múltiplas contas) fez
--   DROP INDEX uq_consumos_condo_periodo_conc   (único nas 4 colunas)
--   e criou o índice PARCIAL uq_consumos_condo_periodo_conc_hash
--   ON consumos_faturas(condominio_id, ano_referencia, mes_referencia, concessionaria, arquivo_hash)
--   WHERE arquivo_hash IS NOT NULL.
-- Mas o trigger sync_concessionaria_to_consumos() (0044) continuou usando o
-- ON CONFLICT antigo (4 colunas, sem hash), que não casa com nenhum índice único.
--
-- Fix: alinhar o ON CONFLICT ao índice parcial (incluir arquivo_hash + o WHERE).
--   - arquivo_hash NOT NULL  -> mesmo PDF atualiza; PDFs diferentes = linhas separadas
--     (exatamente o comportamento de "múltiplas contas" da 0055).
--   - arquivo_hash NULL      -> fora do índice parcial, então não há conflito e
--     simplesmente insere (lançamento sem hash não quebra mais).
-- ==========================================

CREATE OR REPLACE FUNCTION public.sync_concessionaria_to_consumos()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.categoria = 'concessionaria'
     AND NEW.subtipo IS NOT NULL
     AND NEW.mes_referencia IS NOT NULL
     AND NEW.ano_referencia IS NOT NULL
     AND NEW.condominio_id IS NOT NULL THEN
    INSERT INTO public.consumos_faturas (
      condominio_id, mes_referencia, ano_referencia, concessionaria,
      vencimento, valor, arquivo_url, arquivo_nome, arquivo_hash,
      status, enviada_por, anexada_por, anexada_em,
      origem_emissao_arquivo_id
    )
    VALUES (
      NEW.condominio_id, NEW.mes_referencia, NEW.ano_referencia, UPPER(TRIM(NEW.subtipo)),
      NEW.vencimento_fatura, NEW.valor_fatura, NEW.arquivo_url, NEW.arquivo_nome, NEW.arquivo_hash,
      'anexada', NEW.uploaded_by, NEW.uploaded_by, now(),
      NEW.id
    )
    ON CONFLICT (condominio_id, ano_referencia, mes_referencia, concessionaria, arquivo_hash)
      WHERE arquivo_hash IS NOT NULL
      DO UPDATE SET
        vencimento = COALESCE(EXCLUDED.vencimento, public.consumos_faturas.vencimento),
        valor = COALESCE(EXCLUDED.valor, public.consumos_faturas.valor),
        arquivo_url = EXCLUDED.arquivo_url,
        arquivo_nome = EXCLUDED.arquivo_nome,
        arquivo_hash = COALESCE(EXCLUDED.arquivo_hash, public.consumos_faturas.arquivo_hash),
        status = 'anexada',
        anexada_em = now(),
        origem_emissao_arquivo_id = EXCLUDED.origem_emissao_arquivo_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==========================================
-- MIGRATION: Rastreabilidade da emissão de origem em consumos_faturas
-- Permite linkar a fatura de volta ao arquivo de emissão que a gerou,
-- igual já existe em consumos_relatorios_leitura.origem_emissao_arquivo_id.
-- Atualiza o trigger sync_concessionaria_to_consumos pra preencher.
-- ==========================================

ALTER TABLE public.consumos_faturas
  ADD COLUMN IF NOT EXISTS origem_emissao_arquivo_id UUID;

CREATE INDEX IF NOT EXISTS idx_consumos_faturas_origem
  ON public.consumos_faturas(origem_emissao_arquivo_id)
  WHERE origem_emissao_arquivo_id IS NOT NULL;

-- Trigger atualizado: agora também grava a origem (NEW.id do emissoes_arquivos)
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
      vencimento, valor, arquivo_url, arquivo_nome,
      status, enviada_por, anexada_por, anexada_em,
      origem_emissao_arquivo_id
    )
    VALUES (
      NEW.condominio_id, NEW.mes_referencia, NEW.ano_referencia, UPPER(TRIM(NEW.subtipo)),
      NEW.vencimento_fatura, NEW.valor_fatura, NEW.arquivo_url, NEW.arquivo_nome,
      'anexada', NEW.uploaded_by, NEW.uploaded_by, now(),
      NEW.id
    )
    ON CONFLICT (condominio_id, ano_referencia, mes_referencia, concessionaria) DO UPDATE SET
      vencimento = COALESCE(EXCLUDED.vencimento, public.consumos_faturas.vencimento),
      valor = COALESCE(EXCLUDED.valor, public.consumos_faturas.valor),
      arquivo_url = EXCLUDED.arquivo_url,
      arquivo_nome = EXCLUDED.arquivo_nome,
      status = 'anexada',
      anexada_em = now(),
      origem_emissao_arquivo_id = EXCLUDED.origem_emissao_arquivo_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recria o trigger (idempotente)
DROP TRIGGER IF EXISTS trg_sync_concessionaria ON public.emissoes_arquivos;
CREATE TRIGGER trg_sync_concessionaria
  AFTER INSERT OR UPDATE ON public.emissoes_arquivos
  FOR EACH ROW EXECUTE FUNCTION public.sync_concessionaria_to_consumos();

-- Backfill: vincula faturas existentes ao arquivo de emissão correspondente
-- (match por condo + mes + ano + concessionaria/subtipo)
UPDATE public.consumos_faturas cf
SET origem_emissao_arquivo_id = ea.id
FROM public.emissoes_arquivos ea
WHERE cf.origem_emissao_arquivo_id IS NULL
  AND ea.categoria = 'concessionaria'
  AND ea.condominio_id = cf.condominio_id
  AND ea.mes_referencia = cf.mes_referencia
  AND ea.ano_referencia = cf.ano_referencia
  AND UPPER(TRIM(ea.subtipo)) = cf.concessionaria;

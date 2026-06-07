-- ==========================================
-- MIGRATION 0044: Validação de pertencimento + anexo na repetição + hash em emissoes_arquivos
--
-- Resolve 3 problemas reportados em teste:
--  1. Duplicata por hash não bloqueava -> arquivo_hash nunca chegava em consumos_faturas.
--  2. Repetição precisa de motivo E anexo comprobatório (aprovação da repetição).
--  3. (pertencimento é validado no backend; não precisa de coluna nova)
-- ==========================================

-- ---------- 1) Hash do arquivo em emissoes_arquivos ----------
-- Permite detecção de duplicata exata (mesmo PDF) no próprio pacote e o trigger
-- consegue propagar o hash para consumos_faturas / consumos_relatorios_leitura.
ALTER TABLE public.emissoes_arquivos
  ADD COLUMN IF NOT EXISTS arquivo_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_emissoes_arquivos_hash
  ON public.emissoes_arquivos(arquivo_hash)
  WHERE arquivo_hash IS NOT NULL;

-- ---------- 2) Anexo de aprovação na repetição ----------
ALTER TABLE public.consumos_faturas
  ADD COLUMN IF NOT EXISTS repeticao_anexo_url TEXT,
  ADD COLUMN IF NOT EXISTS repeticao_anexo_nome TEXT;

ALTER TABLE public.consumos_relatorios_leitura
  ADD COLUMN IF NOT EXISTS repeticao_anexo_url TEXT,
  ADD COLUMN IF NOT EXISTS repeticao_anexo_nome TEXT;

-- Garante a coluna de origem (caso 0043 ainda não tenha sido aplicada — idempotente)
ALTER TABLE public.consumos_faturas
  ADD COLUMN IF NOT EXISTS origem_emissao_arquivo_id UUID;

-- ---------- 3) Trigger concessionária: copiar arquivo_hash (mantém origem do 0043) ----------
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
    ON CONFLICT (condominio_id, ano_referencia, mes_referencia, concessionaria) DO UPDATE SET
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

-- ---------- 4) Trigger relatório: copiar arquivo_hash ----------
CREATE OR REPLACE FUNCTION public.sync_relatorio_to_consumos()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.categoria = 'relatorio_leitura'
     AND NEW.relatorio_empresa IS NOT NULL
     AND NEW.relatorio_tipo_servico IS NOT NULL
     AND NEW.mes_referencia IS NOT NULL
     AND NEW.ano_referencia IS NOT NULL
     AND NEW.condominio_id IS NOT NULL THEN

    INSERT INTO public.consumos_relatorios_leitura (
      condominio_id, mes_referencia, ano_referencia,
      empresa_leitura, tipo_servico, data_leitura,
      numero_unidades, consumo_total, valor_total,
      arquivo_url, arquivo_nome, arquivo_hash,
      status, enviado_por, anexado_por, anexado_em,
      origem_emissao_arquivo_id
    )
    VALUES (
      NEW.condominio_id, NEW.mes_referencia, NEW.ano_referencia,
      UPPER(TRIM(NEW.relatorio_empresa)), LOWER(TRIM(NEW.relatorio_tipo_servico)),
      NEW.relatorio_data_leitura,
      NEW.relatorio_unidades, NEW.relatorio_consumo_total, NEW.relatorio_valor_total,
      NEW.arquivo_url, NEW.arquivo_nome, NEW.arquivo_hash,
      'anexada', NEW.uploaded_by, NEW.uploaded_by, now(),
      NEW.id
    )
    ON CONFLICT (condominio_id, ano_referencia, mes_referencia, empresa_leitura, tipo_servico) DO UPDATE SET
      data_leitura     = COALESCE(EXCLUDED.data_leitura, public.consumos_relatorios_leitura.data_leitura),
      numero_unidades  = COALESCE(EXCLUDED.numero_unidades, public.consumos_relatorios_leitura.numero_unidades),
      consumo_total    = COALESCE(EXCLUDED.consumo_total, public.consumos_relatorios_leitura.consumo_total),
      valor_total      = COALESCE(EXCLUDED.valor_total, public.consumos_relatorios_leitura.valor_total),
      arquivo_url      = EXCLUDED.arquivo_url,
      arquivo_nome     = EXCLUDED.arquivo_nome,
      arquivo_hash     = COALESCE(EXCLUDED.arquivo_hash, public.consumos_relatorios_leitura.arquivo_hash),
      status           = 'anexada',
      anexado_em       = now(),
      origem_emissao_arquivo_id = EXCLUDED.origem_emissao_arquivo_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Triggers já existem (0037/0040). CREATE OR REPLACE FUNCTION basta.

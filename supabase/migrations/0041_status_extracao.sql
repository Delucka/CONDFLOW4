-- ==========================================
-- MIGRATION: Status de extração automática de PDF em emissoes_arquivos
-- 1. Colunas de status da extração (resultado do pdf_extractor / FastAPI)
-- 2. Colunas de leitura da fatura (extraídas do PDF) + atualização do trigger
--    sync_concessionaria_to_consumos para carregá-las até consumos_faturas
-- ==========================================

-- ---------- 1) Status da extração ----------
--   - extracao_status: pendente | sucesso | parcial | falha
--   - extracao_confianca: 0.00 a 1.00 (% de campos preenchidos)
--   - extracao_dados_brutos: JSONB com o dict cru da extração (debug)
--   - extracao_em: quando foi extraído
ALTER TABLE public.emissoes_arquivos
  ADD COLUMN IF NOT EXISTS extracao_status TEXT
    CHECK (extracao_status IN ('pendente', 'sucesso', 'parcial', 'falha')),
  ADD COLUMN IF NOT EXISTS extracao_confianca NUMERIC(3,2),  -- 0.00 a 1.00
  ADD COLUMN IF NOT EXISTS extracao_dados_brutos JSONB,       -- debug
  ADD COLUMN IF NOT EXISTS extracao_em TIMESTAMPTZ;

-- Índice parcial: só interessa varrer extrações que precisam de atenção
CREATE INDEX IF NOT EXISTS idx_arquivos_extracao_status
  ON public.emissoes_arquivos(extracao_status)
  WHERE extracao_status IN ('parcial', 'falha');

-- ---------- 2) Leituras da fatura de concessionária ----------
-- O trigger 0037 só carregava vencimento/valor. A extração de PDF também captura
-- as datas de leitura (usadas na detecção de duplicata mês-a-mês), então passamos
-- a persistir essas colunas e a sincronizá-las com consumos_faturas.
ALTER TABLE public.emissoes_arquivos
  ADD COLUMN IF NOT EXISTS leitura_atual_fatura DATE,
  ADD COLUMN IF NOT EXISTS proxima_leitura_fatura DATE;

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
      vencimento, valor, leitura_atual, proxima_leitura,
      arquivo_url, arquivo_nome,
      status, enviada_por, anexada_por, anexada_em
    )
    VALUES (
      NEW.condominio_id, NEW.mes_referencia, NEW.ano_referencia, UPPER(TRIM(NEW.subtipo)),
      NEW.vencimento_fatura, NEW.valor_fatura, NEW.leitura_atual_fatura, NEW.proxima_leitura_fatura,
      NEW.arquivo_url, NEW.arquivo_nome,
      'anexada', NEW.uploaded_by, NEW.uploaded_by, now()
    )
    ON CONFLICT (condominio_id, ano_referencia, mes_referencia, concessionaria) DO UPDATE SET
      vencimento      = COALESCE(EXCLUDED.vencimento, public.consumos_faturas.vencimento),
      valor           = COALESCE(EXCLUDED.valor, public.consumos_faturas.valor),
      leitura_atual   = COALESCE(EXCLUDED.leitura_atual, public.consumos_faturas.leitura_atual),
      proxima_leitura = COALESCE(EXCLUDED.proxima_leitura, public.consumos_faturas.proxima_leitura),
      arquivo_url     = EXCLUDED.arquivo_url,
      arquivo_nome    = EXCLUDED.arquivo_nome,
      status          = 'anexada',
      anexada_em      = now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger já existe (criado em 0037), a função foi apenas redefinida acima.

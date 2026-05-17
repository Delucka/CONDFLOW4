-- ==========================================
-- MIGRATION: Dados extraidos automaticamente das faturas de concessionaria
-- nome_condominio_fatura: nome conforme aparece na conta (SABESP/COMGAS/ENEL)
-- vencimento_fatura: data de vencimento
-- valor_fatura: valor total a pagar
-- dados_extraidos_em: timestamp da extracao por IA (null = nao extraido ainda)
-- ==========================================

ALTER TABLE public.emissoes_arquivos
  ADD COLUMN IF NOT EXISTS nome_condominio_fatura TEXT;

ALTER TABLE public.emissoes_arquivos
  ADD COLUMN IF NOT EXISTS vencimento_fatura DATE;

ALTER TABLE public.emissoes_arquivos
  ADD COLUMN IF NOT EXISTS valor_fatura NUMERIC(12,2);

ALTER TABLE public.emissoes_arquivos
  ADD COLUMN IF NOT EXISTS dados_extraidos_em TIMESTAMPTZ;

-- Indice para listagem rapida das contas com extracao pendente
CREATE INDEX IF NOT EXISTS idx_emissoes_arquivos_extracao_pendente
  ON public.emissoes_arquivos(categoria, dados_extraidos_em)
  WHERE categoria = 'concessionaria' AND dados_extraidos_em IS NULL;

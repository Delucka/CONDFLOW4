-- ==========================================
-- MIGRATION 0075: Índices no caminho quente de "abrir arquivo"
-- _arquivo_condo_id() (api_routes.py) roda em TODA abertura de arquivo por
-- gerente/assistente e filtra por colunas de URL/path que não tinham índice ->
-- varredura de tabela inteira a cada boleto/documento aberto. Com ~21k boletos/mês
-- (abertos várias vezes) isso vira o gargalo. Estes índices trocam scan por lookup.
-- Cada índice num bloco próprio: se a coluna não existir, apenas avisa (não aborta).
-- Seguro e reversível (DROP INDEX <nome>).
-- ==========================================

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_emissoes_arquivos_url ON public.emissoes_arquivos(arquivo_url);
EXCEPTION WHEN undefined_column OR undefined_table THEN RAISE NOTICE 'skip idx_emissoes_arquivos_url'; END $$;

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_segvias_boleto_url ON public.segundas_vias(boleto_url);
EXCEPTION WHEN undefined_column OR undefined_table THEN RAISE NOTICE 'skip idx_segvias_boleto_url'; END $$;

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_segvias_anexo_url ON public.segundas_vias(anexo_url);
EXCEPTION WHEN undefined_column OR undefined_table THEN RAISE NOTICE 'skip idx_segvias_anexo_url'; END $$;

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_consumos_faturas_url ON public.consumos_faturas(arquivo_url);
EXCEPTION WHEN undefined_column OR undefined_table THEN RAISE NOTICE 'skip idx_consumos_faturas_url'; END $$;

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_consumos_relat_url ON public.consumos_relatorios_leitura(arquivo_url);
EXCEPTION WHEN undefined_column OR undefined_table THEN RAISE NOTICE 'skip idx_consumos_relat_url'; END $$;

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_emissoes_storage_path ON public.emissoes(storage_path);
EXCEPTION WHEN undefined_column OR undefined_table THEN RAISE NOTICE 'skip idx_emissoes_storage_path'; END $$;

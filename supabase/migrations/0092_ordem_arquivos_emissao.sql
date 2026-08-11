-- ============================================================
-- 0092 -- Ordem manual dos arquivos da emissao
-- ============================================================
-- A ordem de extracao era fixa no codigo (lib/extrairEmissao.js):
--   emissao > correios > seguros > agua > gas > energia > cobrancas > rateio
--
-- Serve para a maioria, mas nao para todos: condominio com dois relatorios,
-- anexo que precisa vir antes por causa da conferencia, ordem combinada com o
-- sindico. Nao havia como mudar sem mexer no codigo.
--
-- Esta coluna guarda a ordem que a pessoa arrastou na tela.
--
--   ordem NULL  -> usa a ordem automatica (o padrao, e o caso de quase tudo)
--   ordem 1..N  -> a pessoa arrastou; essa ordem manda
--
-- Arquivo enviado DEPOIS de arrastar nasce com ordem NULL e entra no fim, pela
-- regra automatica. Nao some, e nao bagunca o que ja foi ordenado.
--
-- ROLLBACK:
--   ALTER TABLE public.emissoes_arquivos DROP COLUMN IF EXISTS ordem;
-- ============================================================

ALTER TABLE public.emissoes_arquivos
  ADD COLUMN IF NOT EXISTS ordem integer;

-- Ordenar dentro de um pacote e a unica leitura que usa a coluna.
CREATE INDEX IF NOT EXISTS idx_emissoes_arquivos_pacote_ordem
  ON public.emissoes_arquivos(pacote_id, ordem);

-- ---- Conferencia ----
-- A coluna existe (1 linha):
--   SELECT column_name, data_type FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='emissoes_arquivos'
--      AND column_name='ordem';

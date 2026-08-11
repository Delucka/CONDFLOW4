-- ============================================================
-- 0094 -- Baixa de impressao na expedicao
-- ============================================================
-- A expedicao imprime os boletos e precisa saber o que JA foi impresso. Hoje o
-- unico marco e o pacote inteiro virar 'expedida' -- grosso demais: um pacote
-- tem varios documentos, a impressao acontece aos poucos, e quem volta de um
-- intervalo nao tem como saber onde parou.
--
-- Pior: sem marca, o jeito de nao imprimir duas vezes e lembrar. Isso e o
-- oposto de um controle.
--
-- A baixa e por DOCUMENTO, e nao apaga nada: o arquivo continua guardado para
-- reimpressao e consulta. Marcar impresso e um carimbo, nao um arquivamento.
--
--   impresso_em        NULL  -> ainda na fila
--   impresso_em        data  -> ja saiu na impressora
--   impresso_por_nome        -> quem deu a baixa (para quando alguem perguntar)
--
-- Reimprimir nao limpa a marca; se precisar voltar para a fila, a tela desmarca.
--
-- ROLLBACK:
--   ALTER TABLE public.emissoes_arquivos DROP COLUMN IF EXISTS impresso_em;
--   ALTER TABLE public.emissoes_arquivos DROP COLUMN IF EXISTS impresso_por_nome;
-- ============================================================

ALTER TABLE public.emissoes_arquivos
  ADD COLUMN IF NOT EXISTS impresso_em       timestamptz,
  ADD COLUMN IF NOT EXISTS impresso_por_nome text;

-- A fila de impressao le por pacote e filtra por impresso/nao impresso.
CREATE INDEX IF NOT EXISTS idx_emissoes_arquivos_impresso
  ON public.emissoes_arquivos(pacote_id, impresso_em);

-- ---- Conferencia ----
-- As duas colunas existem (2 linhas):
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='emissoes_arquivos'
--      AND column_name IN ('impresso_em','impresso_por_nome');

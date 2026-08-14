-- ============================================================
-- 0097 -- Indices em emissoes_pacotes, a tabela mais lida do sistema
-- ============================================================
-- Levantamento de 13/08/2026: `emissoes_pacotes` tinha UM indice, enquanto
-- `segundas_vias` tinha cinco. E toda tela consulta emissoes_pacotes.
--
-- As tres formas de busca mais comuns hoje varrem a tabela inteira:
--
--   status                        -- painel, fila de ocorrencias, contagens
--   (ano, mes)                    -- todo recorte de mes
--   (condominio, ano, mes)        -- conjunto de emissao, abrir pacote
--
-- A terceira ja existe (idx_pacotes_condo_mes, da 0086). Faltam as outras duas.
--
-- Hoje sao poucos milhares de linhas e a varredura passa despercebida. Ela cresce
-- linear com o uso, e a fila de ocorrencias sozinha faz seis contagens completas
-- a cada abertura do painel.
--
-- CONCURRENTLY nao e usado de proposito: exige rodar fora de transacao, e o SQL
-- Editor do Supabase envolve o lote numa. Com o volume atual o lock e de
-- milissegundos.
--
-- ROLLBACK:
--   DROP INDEX IF EXISTS public.idx_pacotes_status;
--   DROP INDEX IF EXISTS public.idx_pacotes_periodo_status;
-- ============================================================

-- Busca por status puro: "quantos aguardando registro", "quantos com o gerente".
CREATE INDEX IF NOT EXISTS idx_pacotes_status
  ON public.emissoes_pacotes(status);

-- Recorte de mes + status, que e como o painel e a fila realmente perguntam.
-- A ordem das colunas segue o uso: periodo primeiro (sempre presente), status
-- depois (nem toda consulta filtra).
CREATE INDEX IF NOT EXISTS idx_pacotes_periodo_status
  ON public.emissoes_pacotes(ano_referencia, mes_referencia, status);

-- ---- Conferencia ----
-- Os indices existem (deve listar 4 com os da 0086/0093):
--   SELECT indexname FROM pg_indexes
--    WHERE schemaname='public' AND tablename='emissoes_pacotes'
--    ORDER BY indexname;
--
-- O planejador passou a usar (deve dizer "Index Scan", nao "Seq Scan"):
--   EXPLAIN SELECT count(*) FROM public.emissoes_pacotes WHERE status = 'aprovado';

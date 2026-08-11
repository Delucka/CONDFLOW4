-- ============================================================
-- 0093 -- O UNIQUE que a 0086 achou que tinha derrubado
-- ============================================================
-- A 0086 existe para permitir mais de uma emissao por condominio+mes (um
-- vencimento por grupo). Ela varreu pg_constraint procurando contype='u' e
-- derrubou o que achou. Nao achou este:
--
--   CREATE UNIQUE INDEX idx_emissao_unica_por_competencia
--     ON emissoes_pacotes (condominio_id, mes_referencia, ano_referencia)
--     WHERE eh_retificacao = false AND status != 'rascunho';
--
-- Criado pela 0016. E indice, nao constraint: nao aparece em pg_constraint.
--
-- POR QUE NINGUEM PERCEBEU: o indice e PARCIAL e ignora rascunho. Criar duas
-- emissoes do mesmo mes funcionava; a segunda so era recusada ao SAIR de
-- rascunho, ou seja, na hora de mandar para aprovacao. A funcionalidade de
-- grupos parecia pronta e morreria no primeiro uso real.
--
-- Descoberto em 06/08/2026 pelo ensaio da 0087, que tentou inserir duas
-- emissoes nao-rascunho no mesmo mes e levou 23505.
--
-- O que substitui a protecao: a 0087. Duplicata deixa de ser impedida por
-- construcao e passa a ser governada pela regra de conjunto -- nada e
-- registrado enquanto todas as emissoes do mes nao estiverem aprovadas.
--
-- LICAO (registrada em docs/ESQUEMA-BANCO.md): unicidade em Postgres mora em
-- DOIS lugares. Varrer pg_constraint nao encontra CREATE UNIQUE INDEX. Para ter
-- certeza, olhe pg_indexes com indisunique.
--
-- ROLLBACK:
--   CREATE UNIQUE INDEX IF NOT EXISTS idx_emissao_unica_por_competencia
--     ON public.emissoes_pacotes (condominio_id, mes_referencia, ano_referencia)
--     WHERE eh_retificacao = false AND status != 'rascunho';
--   -- (so volta se nao houver duplicata criada nesse meio-tempo)
-- ============================================================

DROP INDEX IF EXISTS public.idx_emissao_unica_por_competencia;

-- O indice NAO-unico da 0086 continua servindo as consultas por condominio+mes.
CREATE INDEX IF NOT EXISTS idx_pacotes_condo_mes
  ON public.emissoes_pacotes(condominio_id, ano_referencia, mes_referencia);

-- ---- Conferencia ----
-- Nenhum indice unico sobrou em emissoes_pacotes (esperado: 0 linhas).
-- Serve tambem de modelo para conferir outras tabelas:
--   SELECT i.relname AS indice, ix.indisunique
--     FROM pg_index ix
--     JOIN pg_class i ON i.oid = ix.indexrelid
--    WHERE ix.indrelid = 'public.emissoes_pacotes'::regclass
--      AND ix.indisunique
--      AND NOT ix.indisprimary;

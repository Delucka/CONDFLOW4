-- ============================================================================
-- 0104 — Gerente ativo ou inativo
-- ============================================================================
--
-- São 15 gerentes cadastrados e 3 trabalhando (Suellen, Diogo, Victor). O
-- sistema não sabia a diferença: abria o quadro do mês para os 15, e o painel
-- cobrava planilha de gente que não está mais na operação.
--
-- `ativo` começa TRUE para todos. Fazer o contrário deixaria a operação parada
-- na segunda-feira até alguém marcar um por um — e quem marca é quem já sabe
-- quem saiu, não esta migration.
--
-- `ativo_desde` existe para o caso do Iago: cadastra hoje, com data de entrada
-- no mês que vem. Ninguém precisa lembrar de voltar aqui no dia 1º.
-- ============================================================================

ALTER TABLE public.gerentes
  ADD COLUMN IF NOT EXISTS ativo BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS ativo_desde DATE,
  ADD COLUMN IF NOT EXISTS inativado_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS inativado_motivo TEXT;

COMMENT ON COLUMN public.gerentes.ativo IS
  'Está na operação. Inativo não recebe quadro de mês aberto e some das listas de trabalho — o cadastro e o histórico ficam.';
COMMENT ON COLUMN public.gerentes.ativo_desde IS
  'Data em que passa a valer como ativo. Nulo = já vale. Serve para cadastrar quem começa no mês que vem.';
COMMENT ON COLUMN public.gerentes.inativado_em IS
  'Quando saiu da operação. Preenchido pelo sistema ao inativar.';
COMMENT ON COLUMN public.gerentes.inativado_motivo IS
  'Por que saiu. Seis meses depois, "por que este gerente sumiu do painel?" é a pergunta que alguém vai fazer.';

-- Quem está de fato trabalhando hoje: ativo e já dentro da data de início.
-- Uma view em vez de repetir a condição em cada consulta — repetida, uma delas
-- esquece o `ativo_desde` e o Iago aparece um mês antes.
CREATE OR REPLACE VIEW public.gerentes_em_operacao AS
  SELECT *
    FROM public.gerentes
   WHERE ativo IS TRUE
     AND (ativo_desde IS NULL OR ativo_desde <= CURRENT_DATE);

-- Índice para o filtro que passa a existir em toda listagem de trabalho.
CREATE INDEX IF NOT EXISTS idx_gerentes_ativo ON public.gerentes(ativo);


-- ============================================================================
-- CONFERIR (rode depois)
-- ============================================================================
-- SELECT g.nome, p.full_name, g.ativo, g.ativo_desde,
--        (SELECT count(*) FROM condominios c WHERE c.gerente_id = g.id) AS condominios
--   FROM gerentes g
--   LEFT JOIN profiles p ON p.id = g.profile_id
--  ORDER BY g.ativo DESC, condominios DESC;


-- ============================================================================
-- REVERTER
-- ============================================================================
-- DROP VIEW IF EXISTS public.gerentes_em_operacao;
-- DROP INDEX IF EXISTS idx_gerentes_ativo;
-- ALTER TABLE public.gerentes
--   DROP COLUMN IF EXISTS ativo,
--   DROP COLUMN IF EXISTS ativo_desde,
--   DROP COLUMN IF EXISTS inativado_em,
--   DROP COLUMN IF EXISTS inativado_motivo;

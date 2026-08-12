-- ============================================================
-- 0096 -- Condominio prioritario: prazo e o motivo
-- ============================================================
-- Alguns condominios tem prazo contratual de ENTREGA: "ate o dia 20 de cada
-- mes". Outros sao prioridade por motivo que nao cabe num numero -- sindico
-- exigente, historico de reclamacao, contrato novo em observacao.
--
-- Hoje isso vive na cabeca de quem emite. Quem entra novo descobre errando, e
-- quem sai leva o conhecimento junto.
--
-- Duas colunas, porque sao duas informacoes diferentes:
--
--   prazo_expedicao_dia  1..31  dia limite para expedir, todo mes
--   prioridade_motivo    texto  POR QUE este condominio e prioritario
--
-- Prioritario = tem uma das duas. Nao ha um terceiro booleano para manter em
-- sincronia com elas -- estado derivado nao desanda.
--
-- ATENCAO: prazo NAO e vencimento. `due_day` e quando o CONDOMINO paga; o prazo
-- e quando a administradora tem de ENTREGAR. Um condominio pode vencer dia 5 e
-- ter prazo de entrega no dia 20 do mes anterior. Sao datas de mundos
-- diferentes e misturar as duas ja seria erro caro.
--
-- ROLLBACK:
--   ALTER TABLE public.condominios DROP COLUMN IF EXISTS prazo_expedicao_dia;
--   ALTER TABLE public.condominios DROP COLUMN IF EXISTS prioridade_motivo;
-- ============================================================

ALTER TABLE public.condominios
  ADD COLUMN IF NOT EXISTS prazo_expedicao_dia integer,
  ADD COLUMN IF NOT EXISTS prioridade_motivo   text;

-- CHECK em ALTER separado: se a coluna ja existir de uma tentativa anterior, o
-- ADD COLUMN IF NOT EXISTS pula e o constraint nunca entraria junto.
DO $prazo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE table_schema = 'public' AND table_name = 'condominios'
       AND constraint_name = 'condominios_prazo_expedicao_dia_check'
  ) THEN
    ALTER TABLE public.condominios
      ADD CONSTRAINT condominios_prazo_expedicao_dia_check
      CHECK (prazo_expedicao_dia IS NULL OR prazo_expedicao_dia BETWEEN 1 AND 31);
  END IF;
END $prazo$;

-- ---- Conferencia ----
-- As duas colunas existem (2 linhas):
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='condominios'
--      AND column_name IN ('prazo_expedicao_dia','prioridade_motivo');
--
-- Quem ja e prioritario (0 agora; preencher pela tela de cadastro):
--   SELECT name, prazo_expedicao_dia, prioridade_motivo
--     FROM public.condominios
--    WHERE prazo_expedicao_dia IS NOT NULL OR prioridade_motivo IS NOT NULL
--    ORDER BY prazo_expedicao_dia NULLS LAST, name;

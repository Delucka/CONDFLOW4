-- ============================================================================
-- AUDITORIA DE RLS — v2, separando LEITURA de ESCRITA
--
-- A v1 marcava como "regra aberta" qualquer policy sem condição, inclusive as
-- de SELECT. Isso infla o alarme: ler é problema de privacidade, escrever é
-- problema de integridade. São decisões diferentes e precisam aparecer em
-- colunas diferentes.
--
-- Continua sem escrever nada — só catálogo.
--
-- COMO LER
--
--   escrita = 'ABERTA'   existe policy de INSERT/UPDATE/DELETE/ALL sem condição.
--                        Qualquer pessoa logada altera pelo console do navegador.
--                        É a linha que importa.
--   escrita = 'SEM RLS'  pior: nem policy existe, a tabela está escancarada.
--   escrita = 'TRAVADA'  nenhuma policy de escrita. Pela anon não dá para gravar
--                        (o backend com service-role continua gravando). Se uma
--                        TELA grava aí, ela está falhando calada.
--   escrita = 'com regra' tem condição de verdade.
--
--   leitura segue a mesma ideia, para SELECT.
-- ============================================================================

WITH escritas_do_front(tabela) AS (
  VALUES ('alteracoes_rateio'), ('cobrancas_extras'), ('condominio_grupos'),
         ('condominios'), ('emissoes'), ('emissoes_arquivos'),
         ('emissoes_ocorrencias'), ('emissoes_pacotes'),
         ('emissoes_pacotes_aprovacoes'), ('emissoes_preparacao'),
         ('emissoes_retificacoes'), ('notificacoes'), ('pipeline_config'),
         ('processos'), ('profiles'), ('rateios_config'), ('rateios_valores')
),
tabelas AS (
  SELECT c.relname AS tabela, c.relrowsecurity AS rls
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r'
),
p AS (
  SELECT tablename AS tabela, cmd,
         coalesce(btrim(qual), 'true') = 'true'
           AND coalesce(btrim(with_check), 'true') = 'true' AS aberta
    FROM pg_policies WHERE schemaname = 'public'
),
resumo AS (
  SELECT tabela,
         count(*) FILTER (WHERE cmd IN ('INSERT','UPDATE','DELETE','ALL'))               AS w,
         count(*) FILTER (WHERE cmd IN ('INSERT','UPDATE','DELETE','ALL') AND aberta)    AS w_abertas,
         count(*) FILTER (WHERE cmd IN ('SELECT','ALL'))                                 AS r,
         count(*) FILTER (WHERE cmd IN ('SELECT','ALL') AND aberta)                      AS r_abertas
    FROM p GROUP BY tabela
)
SELECT
  t.tabela,
  CASE WHEN e.tabela IS NOT NULL THEN 'SIM' ELSE '' END AS front_grava,
  CASE
    WHEN NOT t.rls                         THEN 'SEM RLS'
    WHEN coalesce(s.w_abertas,0) > 0       THEN 'ABERTA'
    WHEN coalesce(s.w,0) = 0               THEN 'TRAVADA'
    ELSE 'com regra'
  END AS escrita,
  CASE
    WHEN NOT t.rls                         THEN 'SEM RLS'
    WHEN coalesce(s.r_abertas,0) > 0       THEN 'ABERTA'
    WHEN coalesce(s.r,0) = 0               THEN 'TRAVADA'
    ELSE 'com regra'
  END AS leitura
FROM tabelas t
LEFT JOIN resumo s            ON s.tabela = t.tabela
LEFT JOIN escritas_do_front e ON e.tabela = t.tabela
WHERE e.tabela IS NOT NULL          -- só as que o navegador grava
   OR NOT t.rls                     -- + qualquer tabela escancarada
ORDER BY
  CASE
    WHEN NOT t.rls                   THEN 1
    WHEN coalesce(s.w_abertas,0) > 0 THEN 2
    WHEN coalesce(s.w,0) = 0         THEN 3
    ELSE 4
  END,
  t.tabela;

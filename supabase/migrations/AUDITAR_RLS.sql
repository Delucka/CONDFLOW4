-- ============================================================================
-- AUDITORIA DE RLS — o que a chave anon pode fazer sem passar pelo nosso código
--
-- POR QUE ISTO IMPORTA
--
-- O frontend escreve DIRETO no Supabase com a chave anon, que está no navegador
-- de quem usa. Dezessete tabelas recebem insert/update/delete assim. As telas
-- checam papel antes de mostrar o botão, mas o botão não é a tranca: qualquer
-- pessoa logada pode abrir o console do navegador e chamar a mesma API.
--
-- A única tranca real é o RLS do banco. Onde a política é `USING (true)`, ela
-- não tranca nada — só parece que sim.
--
-- Este script NÃO ESCREVE NADA. Só lê catálogo.
--
-- COMO LER
--
--   risco = 'SEM RLS'      a tabela está aberta. Qualquer autenticado escreve.
--   risco = 'RLS SEM REGRA' RLS ligado e nenhuma policy: ninguém acessa pela
--                           anon (o backend com service-role continua entrando).
--                           Se alguma tela usa essa tabela, ela está quebrada.
--   risco = 'REGRA ABERTA'  existe policy com USING/CHECK sempre verdadeiro.
--                           É o caso que engana: parece protegido e não está.
--   risco = 'ok'            tem regra com condição de verdade.
--
-- A coluna `navegador_escreve` marca as que o frontend altera direto — é onde
-- 'SEM RLS' e 'REGRA ABERTA' deixam de ser teoria.
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
  SELECT c.relname AS tabela, c.relrowsecurity AS rls_ligado
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r'
),
regras AS (
  SELECT tablename AS tabela,
         count(*) AS qtd,
         -- Policy que não filtra nada: USING (true), WITH CHECK (true), ou
         -- ambos ausentes (o que na prática libera).
         count(*) FILTER (
           WHERE coalesce(btrim(qual), 'true') = 'true'
             AND coalesce(btrim(with_check), 'true') = 'true'
         ) AS qtd_abertas,
         string_agg(DISTINCT policyname, ', ') AS policies
    FROM pg_policies
   WHERE schemaname = 'public'
   GROUP BY tablename
)
SELECT
  t.tabela,
  CASE WHEN e.tabela IS NOT NULL THEN 'SIM' ELSE '' END AS navegador_escreve,
  CASE
    WHEN NOT t.rls_ligado                         THEN 'SEM RLS'
    WHEN coalesce(r.qtd, 0) = 0                   THEN 'RLS SEM REGRA'
    WHEN coalesce(r.qtd_abertas, 0) > 0           THEN 'REGRA ABERTA'
    ELSE 'ok'
  END AS risco,
  coalesce(r.qtd, 0)          AS policies,
  coalesce(r.policies, '—')   AS quais
FROM tabelas t
LEFT JOIN regras r          ON r.tabela = t.tabela
LEFT JOIN escritas_do_front e ON e.tabela = t.tabela
ORDER BY
  -- o que o navegador escreve e está aberto vem primeiro
  (e.tabela IS NOT NULL) DESC,
  CASE
    WHEN NOT t.rls_ligado               THEN 1
    WHEN coalesce(r.qtd_abertas,0) > 0  THEN 2
    WHEN coalesce(r.qtd,0) = 0          THEN 3
    ELSE 4
  END,
  t.tabela;

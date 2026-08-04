-- ============================================================
-- 0083 — Fecha `aprovacoes` e `arrecadacoes` (tabelas de backend)
-- ============================================================
-- POR QUÊ ESTAS DUAS PRIMEIRO: são as únicas das cinco que sobraram em que o
-- NAVEGADOR nunca encosta. Conferido por varredura no frontend:
--
--   tabela         leituras do cliente   escritas do cliente
--   aprovacoes             0                     0
--   arrecadacoes           0                     0
--
-- Ou seja: risco ZERO de quebrar tela, e mesmo assim fecham buraco real —
-- qualquer pessoa com a chave anon (que é pública, vai no bundle) alcança as
-- duas pela API REST, mesmo sem tela para isso.
--
-- `aprovacoes` é a TRILHA DE AUDITORIA das aprovações de processo. Aberta como
-- está hoje, dá para ler o histórico inteiro e — pior — INSERIR aprovação falsa,
-- forjando que alguém aprovou algo que nunca aprovou. O backend a usa em 6
-- pontos (service-role, que ignora RLS e portanto não é afetado).
--
-- `arrecadacoes` é LEGADO: a 0010 migrou os valores para rateios_config /
-- rateios_valores, e nada mais lê a antiga — nem o front, nem a API. Fechada
-- para não ficar um resquício escancarado.
--
-- MODELO: RLS ligado e NENHUMA policy. É o mais restritivo possível — nega tudo
-- pela chave anon, e o backend continua igual. Mesmo desenho da 0071
-- (`condominos`), pelo mesmo motivo: tabela que só o servidor deve tocar.
--
-- Se um dia uma tela precisar ler alguma delas, aí sim se escreve a policy —
-- com o caso de uso na mão, não por antecipação.
--
-- ⚠️ ROLLBACK IMEDIATO:
--   ALTER TABLE public.aprovacoes   DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.arrecadacoes DISABLE ROW LEVEL SECURITY;
-- ============================================================

-- Limpa policies antigas: a 0001 criou algumas e a 0018 desligou o RLS, então
-- elas existem e são inertes. Deixá-las seria pegadinha para o próximo que ler.
DROP POLICY IF EXISTS "aprovacoes_all_authenticated"   ON public.aprovacoes;
DROP POLICY IF EXISTS "Allow all auth users"           ON public.aprovacoes;
DROP POLICY IF EXISTS "Todos veem historico"           ON public.aprovacoes;

DROP POLICY IF EXISTS "arrecadacoes_all_authenticated" ON public.arrecadacoes;
DROP POLICY IF EXISTS "Allow all auth users"           ON public.arrecadacoes;

ALTER TABLE public.aprovacoes   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.arrecadacoes ENABLE ROW LEVEL SECURITY;

-- ── Conferência ──
-- Deve devolver `true` nas duas, e zero policy:
--   SELECT relname, relrowsecurity FROM pg_class
--    WHERE relnamespace='public'::regnamespace
--      AND relname IN ('aprovacoes','arrecadacoes');
--   SELECT tablename, policyname FROM pg_policies
--    WHERE tablename IN ('aprovacoes','arrecadacoes');   -- 0 linhas
--
-- Teste de tela: NENHUM. Nada no front usa estas duas — é justamente por isso
-- que elas vieram primeiro.

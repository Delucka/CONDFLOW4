-- ============================================================
-- 0089 — Condomínio sem grupo nenhum: o backfill da 0086 tem prazo de validade
-- ============================================================
-- A 0086 deu um grupo "Geral" a todo condomínio que EXISTIA naquele momento.
-- Quem foi cadastrado depois ficou sem grupo nenhum — e ninguém percebeu,
-- porque nada dá erro: a planilha simplesmente não mostra faixa, e a tela de
-- emissão, que espera os grupos do condomínio antes de abrir o pacote, esperava
-- para sempre. Sintoma: "clico no condomínio e não abre", sem mensagem.
--
-- Esta migration fecha o buraco para trás. Para a frente, quem fecha é o
-- `_garantir_grupos()` do backend, chamado ao salvar condomínio.
--
-- Idempotente: o ON CONFLICT usa o UNIQUE (condominio_id, nome) da 0086, então
-- rodar de novo não faz nada. Pode rodar sem medo mesmo se já tiver rodado.
--
-- ⚠️ ROLLBACK: não há o que desfazer com segurança — apagar grupos apagaria
--    também os que já têm verba apontando para eles (rateios_config.grupo_id
--    é ON DELETE SET NULL, então a verba voltaria para "sem grupo"). Se
--    precisar mesmo, apague só os criados agora, por `criado_em`.
-- ============================================================

-- ══ 1. "Geral" para quem não tem nenhum ══
INSERT INTO public.condominio_grupos (condominio_id, nome, due_day, ordem)
SELECT c.id, 'Geral', c.due_day, 0
  FROM public.condominios c
 WHERE NOT EXISTS (
   SELECT 1 FROM public.condominio_grupos g WHERE g.condominio_id = c.id
 )
ON CONFLICT (condominio_id, nome) DO NOTHING;

-- ══ 2. Segundo vencimento de quem tem due_day_2 e ainda não ganhou o grupo ══
-- Cobre tanto quem entrou depois da 0086 quanto quem ganhou o segundo
-- vencimento depois dela.
INSERT INTO public.condominio_grupos (condominio_id, nome, due_day, ordem)
SELECT c.id, 'Vencimento dia ' || c.due_day_2, c.due_day_2, 1
  FROM public.condominios c
 WHERE c.due_day_2 IS NOT NULL
ON CONFLICT (condominio_id, nome) DO NOTHING;

-- ── Conferência ──
-- Nenhum condomínio sem grupo (deve dar 0):
--   SELECT count(*) FROM public.condominios c
--    WHERE NOT EXISTS (SELECT 1 FROM public.condominio_grupos g
--                       WHERE g.condominio_id = c.id);
--
-- Todo condomínio de dois vencimentos tem dois grupos (deve dar 0):
--   SELECT count(*) FROM public.condominios c
--    WHERE c.due_day_2 IS NOT NULL
--      AND (SELECT count(*) FROM public.condominio_grupos g
--            WHERE g.condominio_id = c.id) < 2;

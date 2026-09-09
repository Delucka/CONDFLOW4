-- ============================================================================
-- 0124 — O Iago já está na operação desde 26/08, não desde 01/10
-- ============================================================================
--
-- Rodar DEPOIS da 0123.
--
-- O cadastro dizia que ele entra em 01/10/2026. A 0104 criou `ativo_desde`
-- exatamente para isso, e citando o caso dele pelo nome: "cadastra hoje, com
-- data de entrada no mês que vem".
--
-- Só que ele não esperou outubro. O que o banco registra, em 09/09/2026:
--
--     profile criado            24/08/2026
--     gerente cadastrado        24/08/2026
--     1ª edição mensal aberta   26/08/2026   (competência 10/2026)
--     mais 6 edições abertas    09/09/2026   (competências 11 e 12/2026)
--     13 edições no nome dele, as de outubro já `edicao_finalizada`
--     4 planilhas esperando liberação em Aprovações & Auditoria
--
-- Ou seja: a operação já o trata como gerente há duas semanas, e só o campo
-- discordava. Enquanto discordasse, `situacao_pelo_gerente()` devolvia
-- 'a_entrar' para os 7 condomínios dele e o Painel Central mostrava zero — com
-- o trabalho todo acontecendo em outra tela.
--
-- A data escolhida é 26/08/2026 e não NULL nem "hoje": é o dia em que o sistema
-- registra a primeira edição aberta no nome dele. NULL apagaria a informação de
-- quando ele entrou, e hoje inventaria uma data que a base contradiz.
--
-- Não é preciso mexer nos 7 condomínios: o gatilho `trg_gerente_situacao_carteira`
-- da 0106 já leva a carteira junto quando `ativo_desde` muda. É para isso que
-- ele existe.
-- ============================================================================

UPDATE public.gerentes
   SET ativo_desde = DATE '2026-08-26'
 WHERE nome = 'Iago'
   AND ativo IS TRUE
   AND ativo_desde = DATE '2026-10-01';


-- ============================================================================
-- CONFERIR (rode depois)
-- ============================================================================
-- 1) Os 7 viraram ativo:
--    SELECT c.name, c.situacao, c.situacao_desde
--      FROM condominios c
--      JOIN gerentes g ON g.id = c.gerente_id
--     WHERE g.nome = 'Iago' ORDER BY c.name;
--
-- 2) As contagens: esperado 72 ativo / 253 a_entrar (era 65 / 260).
--    SELECT situacao, count(*) FROM condominios GROUP BY 1 ORDER BY 2 DESC;
--
-- 3) Ninguém mais com data de entrada no futuro:
--    SELECT nome, ativo_desde FROM gerentes
--     WHERE ativo IS TRUE AND ativo_desde > public.hoje_sp();
--
-- 4) E o Painel Central, com o filtro de gerente em "Iago" e o mês em
--    Outubro/2026, passa a listar os 7 em vez de "Nenhum condomínio encontrado".


-- ============================================================================
-- REVERTER
-- ============================================================================
-- UPDATE public.gerentes SET ativo_desde = DATE '2026-10-01' WHERE nome = 'Iago';
-- (o mesmo gatilho devolve os 7 para 'a_entrar')

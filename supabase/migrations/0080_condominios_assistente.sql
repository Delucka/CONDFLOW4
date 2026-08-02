-- 0080 — Coluna `assistente` em condominios (a que nunca existiu)
--
-- Contexto: o formulário de condomínio sempre teve o campo "CARTEIRA / ASSISTENTE",
-- a listagem sempre mostrou "Carteira: {assistente}" e o endpoint /carteiras sempre
-- leu `condominios.assistente` como override do mapa fixo de assistentes. Só que a
-- coluna NUNCA foi criada — nem no 0001_schema.sql, nem em ALTER nenhum.
--
-- Consequência: o POST /condominios/salvar mandava a chave `assistente` no payload
-- e o PostgREST respondia
--     PGRST204 "Could not find the 'assistente' column of 'condominios'"
-- derrubando o cadastro INTEIRO de qualquer condomínio novo — mesmo com o campo
-- em branco. Ou seja: nunca foi possível cadastrar condomínio por essa tela.
--
-- O backend já foi ajustado pra só mandar a coluna quando preenchida (destrava sem
-- migration). Esta migration cria a coluna de fato, pra o campo passar a funcionar.
--
-- Seguro rodar a qualquer momento: IF NOT EXISTS, sem default, sem NOT NULL, nada
-- reescrito. Reversível com o DROP comentado no fim.

ALTER TABLE public.condominios
  ADD COLUMN IF NOT EXISTS assistente TEXT;

COMMENT ON COLUMN public.condominios.assistente IS
  'Nome da carteira/assistente responsável. Override opcional do mapa de assistentes '
  'usado em /carteiras. Vínculo formal assistente→gerente vive em profiles.gerente_id (0057).';

-- Reversão:
-- ALTER TABLE public.condominios DROP COLUMN IF EXISTS assistente;

-- ============================================================================
-- 0110 — Filipeta: o segundo papel que sai junto com o boleto
-- ============================================================================
--
-- A expedição não imprime só boleto. Parte dos condomínios manda junto uma
-- FILIPETA — o informativo que vai no mesmo envelope. Hoje ela não existe no
-- sistema: quem expede sobe tudo pela mesma porta e o arquivo entra como
-- 'boleto' (0095), então a expedição recebe dois papéis contados como um só e
-- não tem como saber se a filipeta veio ou ficou para trás.
--
-- Duas coisas, porque são duas perguntas diferentes:
--
--   categoria = 'filipeta'   O QUE este arquivo é.
--   usa_filipeta             SE este condomínio deveria ter uma.
--
-- A segunda é o que transforma o esquecimento em aviso. Sem ela, filipeta que
-- falta é indistinguível de filipeta que nunca existiu — e a expedição só
-- descobre depois de o envelope ter saído.
--
-- Não há gatilho travando nada: a emissão sai sem filipeta se for o caso. A
-- marca serve para a tela avisar, não para impedir.
--
-- ROLLBACK:
--   ALTER TABLE public.condominios DROP COLUMN IF EXISTS usa_filipeta;
--   ALTER TABLE public.emissoes_arquivos DROP CONSTRAINT emissoes_arquivos_categoria_check;
--   ALTER TABLE public.emissoes_arquivos ADD CONSTRAINT emissoes_arquivos_categoria_check
--     CHECK (categoria IN ('emissao','concessionaria','outros','relatorio_leitura','boleto'));
--   (rodar o DROP da coluna só se nenhum arquivo estiver com categoria 'filipeta')
-- ============================================================================

ALTER TABLE public.emissoes_arquivos
  DROP CONSTRAINT IF EXISTS emissoes_arquivos_categoria_check;

ALTER TABLE public.emissoes_arquivos
  ADD CONSTRAINT emissoes_arquivos_categoria_check
  CHECK (categoria IN ('emissao', 'concessionaria', 'outros', 'relatorio_leitura', 'boleto', 'filipeta'));


ALTER TABLE public.condominios
  ADD COLUMN IF NOT EXISTS usa_filipeta boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.condominios.usa_filipeta IS
  'Este condomínio manda filipeta junto com o boleto. A expedição avisa quando ela não veio.';

-- A fila de expedição lê boleto e filipeta do mesmo pacote, na mesma consulta.
CREATE INDEX IF NOT EXISTS idx_emissoes_arquivos_expedicao
  ON public.emissoes_arquivos(pacote_id, categoria)
  WHERE categoria IN ('boleto', 'filipeta');


-- ============================================================================
-- CONFERIR (rode depois)
-- ============================================================================
-- A coluna existe (1 linha):
--   SELECT column_name, data_type FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='condominios' AND column_name='usa_filipeta';
--
-- O CHECK aceita 'filipeta' (deve rodar sem erro e devolver 0):
--   SELECT count(*) FROM public.emissoes_arquivos WHERE categoria = 'filipeta';
--
-- Quem manda filipeta (0 agora; marcar pela tela de cadastro):
--   SELECT name FROM public.condominios WHERE usa_filipeta ORDER BY name;

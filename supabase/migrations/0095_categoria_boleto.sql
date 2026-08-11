-- ============================================================
-- 0095 -- Categoria 'boleto', e o insert que nunca funcionou
-- ============================================================
-- O modal "Expedir Emissao" sobe os boletos e grava a linha em
-- emissoes_arquivos com:
--
--     status: 'expedida'
--
-- Só que `status` é o enum `emissao_status`, que so aceita 'pendente',
-- 'aprovado' e 'solicitar_correcao' (0005). E o insert tambem nao mandava
-- `tipo`, que e NOT NULL sem default.
--
-- Dois motivos para o insert falhar -- e ele falhava CALADO: o codigo faz
--
--     await supabase.from('emissoes_arquivos').insert({...})
--
-- sem ler o retorno. supabase-js DEVOLVE {error}, nao lanca (Armadilha 1 do
-- docs/ESQUEMA-BANCO.md). A tela marcava o arquivo como "done" e ninguem via
-- nada.
--
-- CONSEQUENCIA: todo boleto anexado pelo "Expedir" foi para o bucket e NUNCA
-- teve linha na tabela. Os arquivos existem no storage, orfaos, sem nada
-- apontando para eles. Por isso a fila de expedicao aparecia vazia.
--
-- Descoberto em 11/08/2026, quando uma consulta por status='expedida' devolveu
-- 22P02 -- o proprio banco recusando o valor que o app vinha gravando.
--
-- ---- O que esta migration faz ----
-- Abre a categoria 'boleto'. O marcador certo para "este arquivo e um boleto" e
-- `categoria`, que e TEXT com CHECK -- nao `status`, que descreve o estagio de
-- aprovacao do arquivo e nao o que ele e.
--
-- ROLLBACK:
--   ALTER TABLE public.emissoes_arquivos DROP CONSTRAINT emissoes_arquivos_categoria_check;
--   ALTER TABLE public.emissoes_arquivos ADD CONSTRAINT emissoes_arquivos_categoria_check
--     CHECK (categoria IN ('emissao','concessionaria','outros','relatorio_leitura'));
-- ============================================================

ALTER TABLE public.emissoes_arquivos
  DROP CONSTRAINT IF EXISTS emissoes_arquivos_categoria_check;

ALTER TABLE public.emissoes_arquivos
  ADD CONSTRAINT emissoes_arquivos_categoria_check
  CHECK (categoria IN ('emissao', 'concessionaria', 'outros', 'relatorio_leitura', 'boleto'));

-- ---- Conferencia ----
-- Aceita 'boleto' agora (deve rodar sem erro e devolver 0 linhas):
--   SELECT count(*) FROM public.emissoes_arquivos WHERE categoria = 'boleto';
--
-- Valores em uso hoje:
--   SELECT categoria, count(*) FROM public.emissoes_arquivos GROUP BY 1 ORDER BY 2 DESC;

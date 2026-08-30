-- ============================================================================
-- 0111 — A entrega ao cliente, que é onde o trabalho realmente termina
-- ============================================================================
--
-- A expedição não é a impressora. Ela imprime o trabalho final E leva ao
-- cliente — e é essa segunda metade que o sistema não registrava.
--
-- Hoje o único marco é `impresso_em` por arquivo (0094). Saiu da impressora e
-- acabou a trilha. Só que entre a impressora e o síndico existe o pedaço que
-- todo mundo cobra: "chegou?", "quando?", "quem recebeu?". A resposta vivia na
-- memória de quem entregou.
--
-- Pior: `prazo_expedicao_dia` (0096) é prazo de ENTREGA. O sistema guardava a
-- data limite de um evento que não sabia registrar — o prazo existia, o
-- cumprimento não.
--
-- Três colunas, no PACOTE e não no arquivo: entrega-se a remessa inteira, não
-- folha por folha.
--
--   entregue_em        NULL -> ainda com a expedição · data -> chegou ao cliente
--   entregue_por_nome  quem da expedição levou
--   recebido_por       quem recebeu do lado do cliente (opcional, texto livre)
--
-- `recebido_por` é texto solto de propósito: quem recebe é o zelador, a
-- secretária, o síndico, às vezes "portaria". Uma tabela de pessoas do
-- condomínio seria um cadastro a mais para manter, e ninguém manteria.
--
-- Desfazer é possível (a tela devolve para "a entregar") — marcar errado é
-- comum e não pode virar dívida permanente.
--
-- ROLLBACK:
--   ALTER TABLE public.emissoes_pacotes
--     DROP COLUMN IF EXISTS entregue_em,
--     DROP COLUMN IF EXISTS entregue_por_nome,
--     DROP COLUMN IF EXISTS recebido_por;
-- ============================================================================

ALTER TABLE public.emissoes_pacotes
  ADD COLUMN IF NOT EXISTS entregue_em       timestamptz,
  ADD COLUMN IF NOT EXISTS entregue_por_nome text,
  ADD COLUMN IF NOT EXISTS recebido_por      text;

COMMENT ON COLUMN public.emissoes_pacotes.entregue_em IS
  'Quando a remessa chegou ao cliente. NULL = ainda com a expedição.';
COMMENT ON COLUMN public.emissoes_pacotes.recebido_por IS
  'Quem recebeu no condomínio — zelador, portaria, síndico. Texto livre.';

-- A fila da expedição pergunta "o que ainda não foi entregue" o tempo todo.
CREATE INDEX IF NOT EXISTS idx_emissoes_pacotes_a_entregar
  ON public.emissoes_pacotes(mes_referencia, ano_referencia)
  WHERE entregue_em IS NULL;


-- ============================================================================
-- CONFERIR (rode depois)
-- ============================================================================
-- As três colunas existem (3 linhas):
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='emissoes_pacotes'
--      AND column_name IN ('entregue_em','entregue_por_nome','recebido_por');
--
-- O que já saiu e ainda não consta como entregue (tudo, agora):
--   SELECT c.name, p.mes_referencia, p.ano_referencia
--     FROM emissoes_pacotes p JOIN condominios c ON c.id = p.condominio_id
--    WHERE p.status = 'expedida' AND p.entregue_em IS NULL
--    ORDER BY p.ano_referencia DESC, p.mes_referencia DESC, c.name;

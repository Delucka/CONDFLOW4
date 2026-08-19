-- ============================================================
-- 0102 — A correção lembra de onde saiu
-- ============================================================
-- A 0101 fez a emissão corrigida voltar para o PAPEL de quem pediu a correção.
-- Funciona quando quem pede é aprovador (gerente, supervisor), mas não quando é
-- o master ou a emissão pedindo em nome de alguém — e aí caía no caminho
-- antigo, que recomeça o fluxo e joga a emissão na supervisora de
-- contabilidade.
--
-- Aconteceu no 302 (nível 4): a correção saiu como "Correção por Administrador
-- Master" e a emissão voltou para a SPC em vez de voltar para o gerente.
--
-- A regra certa é mais simples e não depende de quem clicou: a emissão volta
-- para O MARCO EM QUE ESTAVA quando a correção foi pedida. Se estava com o
-- gerente, volta para o gerente — não importa quem apertou o botão.
--
-- Para isso basta guardar o status de antes.
--
-- ⚠️ ROLLBACK:
--   ALTER TABLE public.emissoes_pacotes DROP COLUMN IF EXISTS status_pre_correcao;
-- ============================================================

ALTER TABLE public.emissoes_pacotes
  ADD COLUMN IF NOT EXISTS status_pre_correcao TEXT;

COMMENT ON COLUMN public.emissoes_pacotes.status_pre_correcao IS
  'Status imediatamente anterior ao pedido de correção. É para cá que a emissão volta depois de corrigida — o marco, não o papel de quem pediu.';

-- Preenche o que dá para saber das correções já abertas.
--
-- Onde a trilha registra o papel de quem pediu, dá para inferir o marco: quem
-- estava conferindo é quem pediu. Onde não dá (correção pedida pelo master), a
-- coluna fica NULL e o comportamento continua o de antes — melhor um vazio
-- honesto do que um palpite que manda a emissão para o lugar errado.
UPDATE public.emissoes_pacotes p
   SET status_pre_correcao = CASE t.role
         WHEN 'gerente'                   THEN 'pendente_gerente'
         WHEN 'supervisor_gerentes'       THEN 'pendente_sup_gerentes'
         WHEN 'supervisora_contabilidade' THEN 'pendente_sup_contabilidade'
         WHEN 'supervisora'               THEN 'pendente_sup_contabilidade'
       END
  FROM (
    SELECT DISTINCT ON (pacote_id) pacote_id, role
      FROM public.emissoes_pacotes_aprovacoes
     WHERE acao = 'correcao'
     ORDER BY pacote_id, criado_em DESC
  ) t
 WHERE t.pacote_id = p.id
   AND p.status = 'solicitar_correcao'
   AND p.status_pre_correcao IS NULL
   AND t.role IN ('gerente','supervisor_gerentes','supervisora_contabilidade','supervisora');

-- ── Conferência ──
--   SELECT status_pre_correcao, count(*) FROM public.emissoes_pacotes
--    WHERE status = 'solicitar_correcao' GROUP BY 1;

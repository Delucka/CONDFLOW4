-- ============================================================================
-- Devolver a emissão do 302 (09/2026) para o gerente
--
-- A correção dela foi pedida em 18/08, antes de a coluna do marco existir, e o
-- reenvio a mandou para a supervisora de contabilidade. Como ela JÁ ANDOU, não
-- basta gravar o marco: é preciso trazê-la de volta.
--
-- Rode o passo 1 primeiro e confira a linha antes de rodar o passo 2.
-- ============================================================================

-- ── PASSO 1: ver o que será alterado (não muda nada) ──
SELECT p.id,
       c.name          AS condominio,
       p.mes_referencia, p.ano_referencia,
       p.status        AS status_agora,
       p.nivel_aprovacao,
       p.status_pre_correcao,
       p.correcao_por_nome,
       p.correcao_em
  FROM public.emissoes_pacotes p
  JOIN public.condominios c ON c.id = p.condominio_id
 WHERE c.name LIKE '302%'
   AND p.mes_referencia = 9
   AND p.ano_referencia = 2026;

-- Confira: deve aparecer UMA linha, com status_agora = 'pendente_sup_contabilidade'.
-- Se aparecer mais de uma, me diga antes de seguir — o passo 2 mexeria nas duas.


-- ── PASSO 2: devolver ao gerente ──
-- Só roda se o status ainda for o da supervisora de contabilidade: se alguém já
-- tiver mexido no meio-tempo, nada acontece, em vez de atropelar.
UPDATE public.emissoes_pacotes p
   SET status = 'pendente_gerente',
       -- Grava o marco também: se pedirem correção de novo, a volta já sabe
       -- para onde é, sem depender de quem clicou.
       status_pre_correcao = 'pendente_gerente',
       atualizado_em = now()
  FROM public.condominios c
 WHERE c.id = p.condominio_id
   AND c.name LIKE '302%'
   AND p.mes_referencia = 9
   AND p.ano_referencia = 2026
   AND p.status = 'pendente_sup_contabilidade';

-- ── PASSO 3: conferir ──
SELECT c.name, p.status, p.status_pre_correcao
  FROM public.emissoes_pacotes p
  JOIN public.condominios c ON c.id = p.condominio_id
 WHERE c.name LIKE '302%' AND p.mes_referencia = 9 AND p.ano_referencia = 2026;

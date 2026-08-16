-- ============================================================================
-- Quanto estrago a 0086 fez enquanto os grupos ficaram invisíveis
--
-- De 05/08 (0086) a 16/08/2026 (0098), `condominio_grupos` era inacessível pela
-- chave anon. Na criação da emissão o grupo vem de
-- `grupoId || gruposCondo[0]?.id || null` — com a lista vazia, sempre null.
--
-- Este script só CONTA. Nada é alterado.
-- ============================================================================

-- 1) Quantos condomínios têm mais de um grupo (os que sofrem de verdade)
SELECT 'condominios com 2+ grupos' AS o_que, count(*) AS quantos
  FROM (SELECT condominio_id FROM public.condominio_grupos
         WHERE ativo GROUP BY condominio_id HAVING count(*) > 1) x

UNION ALL

-- 2) Emissões sem grupo criadas na janela do problema
SELECT 'emissoes sem grupo desde 05/08', count(*)
  FROM public.emissoes_pacotes
 WHERE grupo_id IS NULL AND criado_em >= '2026-08-05'

UNION ALL

-- 3) Dessas, as que são de condomínio com 2+ grupos — o caso grave: uma emissão
--    só onde deviam existir duas
SELECT 'delas, em condominio de 2+ grupos', count(*)
  FROM public.emissoes_pacotes p
 WHERE p.grupo_id IS NULL AND p.criado_em >= '2026-08-05'
   AND p.condominio_id IN (
        SELECT condominio_id FROM public.condominio_grupos
         WHERE ativo GROUP BY condominio_id HAVING count(*) > 1)

UNION ALL

-- 4) Emissões sem grupo em condomínio de UM grupo só — essas o backfill resolve
--    sozinho, sem ninguém decidir nada
SELECT 'delas, em condominio de 1 grupo (backfill trivial)', count(*)
  FROM public.emissoes_pacotes p
 WHERE p.grupo_id IS NULL AND p.criado_em >= '2026-08-05'
   AND p.condominio_id IN (
        SELECT condominio_id FROM public.condominio_grupos
         WHERE ativo GROUP BY condominio_id HAVING count(*) = 1);

-- ── E a lista dos casos que precisam de decisão humana ──
-- Condomínio de dois vencimentos com UMA emissão só no mês: é aqui que alguém
-- precisa olhar e dizer se falta emitir a outra metade.
SELECT c.name AS condominio,
       p.mes_referencia AS mes,
       p.ano_referencia AS ano,
       p.status,
       count(*) OVER (PARTITION BY p.condominio_id, p.mes_referencia, p.ano_referencia) AS emissoes_no_mes,
       (SELECT count(*) FROM public.condominio_grupos g
         WHERE g.condominio_id = p.condominio_id AND g.ativo) AS grupos_do_condo
  FROM public.emissoes_pacotes p
  JOIN public.condominios c ON c.id = p.condominio_id
 WHERE p.grupo_id IS NULL
   AND p.criado_em >= '2026-08-05'
   AND p.condominio_id IN (
        SELECT condominio_id FROM public.condominio_grupos
         WHERE ativo GROUP BY condominio_id HAVING count(*) > 1)
 ORDER BY c.name, p.ano_referencia, p.mes_referencia;

-- ============================================================================
-- Quanto de "próxima leitura" já está guardado no banco
--
-- O backend extrai esse campo desde a 0041 e um trigger o espelha em
-- `consumos_faturas`. Só o caminho do OCR no navegador não extraía. Então o
-- histórico pode já existir para as faturas que vieram como PDF de texto.
--
-- Só lê. Não altera nada.
-- ============================================================================

-- 1) Panorama: quantas faturas têm a data, por concessionária
SELECT
  concessionaria,
  count(*)                                            AS faturas,
  count(proxima_leitura)                              AS com_proxima_leitura,
  round(100.0 * count(proxima_leitura) / count(*), 0) AS pct,
  min(proxima_leitura)                                AS mais_antiga,
  max(proxima_leitura)                                AS mais_recente
FROM public.consumos_faturas
GROUP BY concessionaria
ORDER BY faturas DESC;

-- 2) O mesmo pelo lado da emissão (é daqui que a tela lê)
SELECT
  'emissoes_arquivos' AS origem,
  count(*) FILTER (WHERE categoria = 'concessionaria')                                 AS faturas_anexadas,
  count(*) FILTER (WHERE categoria = 'concessionaria' AND proxima_leitura_fatura IS NOT NULL) AS com_data
FROM public.emissoes_arquivos;

-- 3) O que interessa para cobrar: a próxima leitura mais recente de cada
--    condomínio + concessionária. É esta lista que vira agenda.
SELECT c.name AS condominio,
       f.concessionaria,
       f.proxima_leitura,
       f.mes_referencia || '/' || f.ano_referencia AS fatura_de,
       f.vencimento
  FROM public.consumos_faturas f
  JOIN public.condominios c ON c.id = f.condominio_id
 WHERE f.proxima_leitura IS NOT NULL
   AND f.proxima_leitura >= current_date - interval '60 days'
 ORDER BY f.proxima_leitura, c.name
 LIMIT 60;

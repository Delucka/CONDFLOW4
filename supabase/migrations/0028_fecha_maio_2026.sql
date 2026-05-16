-- ==========================================
-- MIGRATION: Fecha antecipadamente a emissão de Maio/2026
-- Os processos de emissão dessa competência foram finalizados antes do
-- prazo regular (dia 15). Marca todos os condomínios com etapa
-- 'pronto_para_emitir' para Maio/2026, travando edição da planilha,
-- cobranças extras e nova preparação.
-- ==========================================

INSERT INTO public.emissoes_preparacao (
  condominio_id,
  mes_referencia,
  ano_referencia,
  etapa,
  notas,
  atualizado_em
)
SELECT
  id,
  5,
  2026,
  'pronto_para_emitir',
  'Fechado antecipadamente pela administração (Maio/2026)',
  NOW()
FROM public.condominios
ON CONFLICT (condominio_id, mes_referencia, ano_referencia)
DO UPDATE SET
  etapa = 'pronto_para_emitir',
  atualizado_em = NOW(),
  notas = COALESCE(
    public.emissoes_preparacao.notas,
    'Fechado antecipadamente pela administração (Maio/2026)'
  );

-- Relatório
SELECT
  COUNT(*) AS total_marcados,
  COUNT(DISTINCT condominio_id) AS condos_unicos
FROM public.emissoes_preparacao
WHERE mes_referencia = 5
  AND ano_referencia = 2026
  AND etapa = 'pronto_para_emitir';

-- ==========================================
-- MIGRATION 0055: Permitir múltiplas faturas da MESMA concessionária no mês
-- Caso real: condomínios com 2+ instalações (ex.: DONA RACHEL 0340 com 2 ENEL,
-- instalação final 10 e 18). O índice antigo bloqueava a 2ª conta.
-- Mantém o bloqueio de RE-UPLOAD do MESMO arquivo (mesmo arquivo_hash).
-- ==========================================

DROP INDEX IF EXISTS uq_consumos_condo_periodo_conc;

-- Só impede o mesmo PDF (hash) duas vezes para o mesmo condo/mês/concessionária.
-- Faturas de instalações diferentes têm hashes diferentes → permitidas.
-- Lançamentos manuais (arquivo_hash NULL) não entram no índice → permitidos.
CREATE UNIQUE INDEX IF NOT EXISTS uq_consumos_condo_periodo_conc_hash
  ON public.consumos_faturas(condominio_id, ano_referencia, mes_referencia, concessionaria, arquivo_hash)
  WHERE arquivo_hash IS NOT NULL;

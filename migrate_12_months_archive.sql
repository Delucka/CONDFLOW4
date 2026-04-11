-- Adicionar coluna de ano para permitir arquivamento e visão anual de 12 meses
ALTER TABLE public.rateios_valores ADD COLUMN ano INTEGER;

-- Atualizar registros existentes para o ano de 2026 (ou ano atual)
UPDATE public.rateios_valores SET ano = 2026 WHERE ano IS NULL;

-- Tornar a coluna obrigatória após a migração de dados
ALTER TABLE public.rateios_valores ALTER COLUMN ano SET NOT NULL;

-- Adicionar índice para performance de consulta por ano
CREATE INDEX IF NOT EXISTS idx_rateios_valores_ano ON public.rateios_valores(ano);

-- Ajustar a constraint de unicidade: agora um valor é único por rateio, mês E ano
ALTER TABLE public.rateios_valores DROP CONSTRAINT IF EXISTS rateios_valores_rateio_id_mes_key;
ALTER TABLE public.rateios_valores ADD CONSTRAINT rateios_valores_rateio_id_mes_ano_key UNIQUE (rateio_id, mes, ano);

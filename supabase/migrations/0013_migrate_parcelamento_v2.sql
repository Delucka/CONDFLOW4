-- Adicionar mês de início para controle de competência no parcelamento
ALTER TABLE public.rateios_config ADD COLUMN mes_inicio INTEGER DEFAULT 1;

COMMENT ON COLUMN public.rateios_config.mes_inicio IS 'Mês (1-12) em que a cobrança efetivamente começa (ex: 4 para Abril)';

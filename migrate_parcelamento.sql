-- Adicionar suporte a parcelamento na tabela rateios_config
ALTER TABLE public.rateios_config ADD COLUMN is_parcelado BOOLEAN DEFAULT FALSE;
ALTER TABLE public.rateios_config ADD COLUMN parcela_total INTEGER DEFAULT 1;
ALTER TABLE public.rateios_config ADD COLUMN parcela_inicio INTEGER DEFAULT 1;

COMMENT ON COLUMN public.rateios_config.is_parcelado IS 'Indica se este rateio é parcelado em vários meses';
COMMENT ON COLUMN public.rateios_config.parcela_total IS 'Número total de parcelas (ex: 12)';
COMMENT ON COLUMN public.rateios_config.parcela_inicio IS 'O número da parcela no primeiro mês do semestre atual (ex: 1)';

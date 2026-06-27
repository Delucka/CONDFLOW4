-- MIGRATION 0069: integração da 2ª via (n8n/WhatsApp/Ahreas)
--   ahreas_ref: casa o pedido com o boleto que volta do Ahreas
--   origem:     'site' | 'whatsapp' (de onde veio o pedido)
ALTER TABLE public.segundas_vias ADD COLUMN IF NOT EXISTS ahreas_ref text;
ALTER TABLE public.segundas_vias ADD COLUMN IF NOT EXISTS origem text;
CREATE INDEX IF NOT EXISTS idx_segvias_ahreas ON public.segundas_vias(ahreas_ref);

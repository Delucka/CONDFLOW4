-- ==========================================
-- MIGRATION: Sincroniza emissoes_arquivos (categoria=concessionaria) -> consumos_faturas
-- Sempre que um arquivo da Central de Emissoes for categorizado como
-- concessionaria e tiver mes/ano/subtipo, ele aparece automaticamente
-- em /consumos com status 'anexada'.
-- ==========================================

CREATE OR REPLACE FUNCTION public.sync_concessionaria_to_consumos()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.categoria = 'concessionaria'
     AND NEW.subtipo IS NOT NULL
     AND NEW.mes_referencia IS NOT NULL
     AND NEW.ano_referencia IS NOT NULL
     AND NEW.condominio_id IS NOT NULL THEN
    INSERT INTO public.consumos_faturas (
      condominio_id, mes_referencia, ano_referencia, concessionaria,
      vencimento, valor, arquivo_url, arquivo_nome,
      status, enviada_por, anexada_por, anexada_em
    )
    VALUES (
      NEW.condominio_id, NEW.mes_referencia, NEW.ano_referencia, UPPER(TRIM(NEW.subtipo)),
      NEW.vencimento_fatura, NEW.valor_fatura, NEW.arquivo_url, NEW.arquivo_nome,
      'anexada', NEW.uploaded_by, NEW.uploaded_by, now()
    )
    ON CONFLICT (condominio_id, ano_referencia, mes_referencia, concessionaria) DO UPDATE SET
      vencimento = COALESCE(EXCLUDED.vencimento, public.consumos_faturas.vencimento),
      valor = COALESCE(EXCLUDED.valor, public.consumos_faturas.valor),
      arquivo_url = EXCLUDED.arquivo_url,
      arquivo_nome = EXCLUDED.arquivo_nome,
      status = 'anexada',
      anexada_em = now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_sync_concessionaria ON public.emissoes_arquivos;
CREATE TRIGGER trg_sync_concessionaria
  AFTER INSERT OR UPDATE ON public.emissoes_arquivos
  FOR EACH ROW EXECUTE FUNCTION public.sync_concessionaria_to_consumos();

-- Fix: 088 tambem usa COMGAS
INSERT INTO public.condominios_concessionarias (condominio_id, concessionaria)
SELECT c.id, 'COMGAS' FROM public.condominios c
WHERE c.name ILIKE '088 %' OR c.name ILIKE '088-%' OR c.name ILIKE '088 -%'
ON CONFLICT (condominio_id, concessionaria) DO NOTHING;

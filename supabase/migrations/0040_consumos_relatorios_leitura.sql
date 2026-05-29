-- ==========================================
-- MIGRATION: Sancionamento de repeticao + relatorios de leitura
-- 1. Colunas de sancionamento em consumos_faturas
-- 2. Nova tabela consumos_relatorios_leitura (Prosper, Hidrogeotec, etc)
-- 3. Permitir categoria 'relatorio_leitura' em emissoes_arquivos
-- 4. Trigger pra sincronizar emissoes_arquivos -> consumos_relatorios_leitura
-- ==========================================

-- ---------- 1) Sancionamento em consumos_faturas ----------
ALTER TABLE public.consumos_faturas
  ADD COLUMN IF NOT EXISTS motivo_repeticao TEXT,
  ADD COLUMN IF NOT EXISTS repeticao_confirmada_por UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS repeticao_confirmada_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dados_iguais_mes_anterior BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS variacao_valor_pct NUMERIC;

-- ---------- 2) Tabela de relatorios de leitura ----------
CREATE TABLE IF NOT EXISTS public.consumos_relatorios_leitura (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  condominio_id UUID NOT NULL REFERENCES public.condominios(id) ON DELETE CASCADE,
  mes_referencia SMALLINT NOT NULL CHECK (mes_referencia BETWEEN 1 AND 12),
  ano_referencia SMALLINT NOT NULL,
  empresa_leitura TEXT NOT NULL,                 -- Prosper, Hidrogeotec, etc
  tipo_servico TEXT NOT NULL CHECK (tipo_servico IN ('agua', 'gas')),
  data_leitura DATE,
  numero_unidades INTEGER,
  consumo_total NUMERIC(12,3),                   -- m3 (suporta 3 casas decimais, ex: 1188.704)
  valor_total NUMERIC(12,2),                     -- R$
  arquivo_url TEXT,
  arquivo_nome TEXT,
  arquivo_hash TEXT,
  descricao TEXT,
  marcada_repetida BOOLEAN DEFAULT false,
  motivo_repeticao TEXT,
  repeticao_confirmada_por UUID REFERENCES public.profiles(id),
  repeticao_confirmada_em TIMESTAMPTZ,
  dados_iguais_mes_anterior BOOLEAN DEFAULT false,
  variacao_consumo_pct NUMERIC,
  status TEXT NOT NULL DEFAULT 'anexada' CHECK (status IN ('pendente','anexada')),
  enviado_por UUID REFERENCES public.profiles(id),
  enviado_em TIMESTAMPTZ DEFAULT now(),
  anexado_por UUID REFERENCES public.profiles(id),
  anexado_em TIMESTAMPTZ,
  origem_emissao_arquivo_id UUID                 -- referencia ao emissoes_arquivos que originou
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_relatorios_condo_periodo_emp_tipo
  ON public.consumos_relatorios_leitura(condominio_id, ano_referencia, mes_referencia, empresa_leitura, tipo_servico);

CREATE INDEX IF NOT EXISTS idx_relatorios_condo
  ON public.consumos_relatorios_leitura(condominio_id);

CREATE INDEX IF NOT EXISTS idx_relatorios_periodo
  ON public.consumos_relatorios_leitura(ano_referencia, mes_referencia);

CREATE INDEX IF NOT EXISTS idx_relatorios_hash
  ON public.consumos_relatorios_leitura(arquivo_hash)
  WHERE arquivo_hash IS NOT NULL;

ALTER TABLE public.consumos_relatorios_leitura ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS consumos_relatorios_all_authenticated ON public.consumos_relatorios_leitura;
CREATE POLICY consumos_relatorios_all_authenticated ON public.consumos_relatorios_leitura
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ---------- 3) Permitir categoria 'relatorio_leitura' em emissoes_arquivos ----------
-- Atualiza o CHECK constraint pra aceitar a nova categoria
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'emissoes_arquivos'
      AND constraint_name = 'emissoes_arquivos_categoria_check'
  ) THEN
    ALTER TABLE public.emissoes_arquivos
      DROP CONSTRAINT emissoes_arquivos_categoria_check;
  END IF;
  ALTER TABLE public.emissoes_arquivos
    ADD CONSTRAINT emissoes_arquivos_categoria_check
    CHECK (categoria IN ('emissao', 'concessionaria', 'outros', 'relatorio_leitura'));
END $$;

-- Campos especificos do relatorio (usados pelo trigger)
ALTER TABLE public.emissoes_arquivos
  ADD COLUMN IF NOT EXISTS relatorio_empresa TEXT,
  ADD COLUMN IF NOT EXISTS relatorio_tipo_servico TEXT,
  ADD COLUMN IF NOT EXISTS relatorio_data_leitura DATE,
  ADD COLUMN IF NOT EXISTS relatorio_unidades INTEGER,
  ADD COLUMN IF NOT EXISTS relatorio_consumo_total NUMERIC(12,3),
  ADD COLUMN IF NOT EXISTS relatorio_valor_total NUMERIC(12,2);

-- ---------- 4) Trigger sync relatorio -> consumos_relatorios_leitura ----------
CREATE OR REPLACE FUNCTION public.sync_relatorio_to_consumos()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.categoria = 'relatorio_leitura'
     AND NEW.relatorio_empresa IS NOT NULL
     AND NEW.relatorio_tipo_servico IS NOT NULL
     AND NEW.mes_referencia IS NOT NULL
     AND NEW.ano_referencia IS NOT NULL
     AND NEW.condominio_id IS NOT NULL THEN

    INSERT INTO public.consumos_relatorios_leitura (
      condominio_id, mes_referencia, ano_referencia,
      empresa_leitura, tipo_servico, data_leitura,
      numero_unidades, consumo_total, valor_total,
      arquivo_url, arquivo_nome,
      status, enviado_por, anexado_por, anexado_em,
      origem_emissao_arquivo_id
    )
    VALUES (
      NEW.condominio_id, NEW.mes_referencia, NEW.ano_referencia,
      UPPER(TRIM(NEW.relatorio_empresa)), LOWER(TRIM(NEW.relatorio_tipo_servico)),
      NEW.relatorio_data_leitura,
      NEW.relatorio_unidades, NEW.relatorio_consumo_total, NEW.relatorio_valor_total,
      NEW.arquivo_url, NEW.arquivo_nome,
      'anexada', NEW.uploaded_by, NEW.uploaded_by, now(),
      NEW.id
    )
    ON CONFLICT (condominio_id, ano_referencia, mes_referencia, empresa_leitura, tipo_servico) DO UPDATE SET
      data_leitura     = COALESCE(EXCLUDED.data_leitura, public.consumos_relatorios_leitura.data_leitura),
      numero_unidades  = COALESCE(EXCLUDED.numero_unidades, public.consumos_relatorios_leitura.numero_unidades),
      consumo_total    = COALESCE(EXCLUDED.consumo_total, public.consumos_relatorios_leitura.consumo_total),
      valor_total      = COALESCE(EXCLUDED.valor_total, public.consumos_relatorios_leitura.valor_total),
      arquivo_url      = EXCLUDED.arquivo_url,
      arquivo_nome     = EXCLUDED.arquivo_nome,
      status           = 'anexada',
      anexado_em       = now(),
      origem_emissao_arquivo_id = EXCLUDED.origem_emissao_arquivo_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_sync_relatorio ON public.emissoes_arquivos;
CREATE TRIGGER trg_sync_relatorio
  AFTER INSERT OR UPDATE ON public.emissoes_arquivos
  FOR EACH ROW EXECUTE FUNCTION public.sync_relatorio_to_consumos();

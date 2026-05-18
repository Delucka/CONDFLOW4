-- ==========================================
-- MIGRATION: Faturas de Consumo (SABESP/COMGAS/ENEL etc)
-- Armazena historico de faturas por condominio/mes/concessionaria.
-- Workflow: assistente sobe rascunho → emissor 'anexa' como final.
-- Auto-deteccao de duplicata via hash SHA256 do PDF + flag manual.
-- ==========================================

CREATE TABLE IF NOT EXISTS public.consumos_faturas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  condominio_id UUID NOT NULL REFERENCES public.condominios(id) ON DELETE CASCADE,
  mes_referencia SMALLINT NOT NULL CHECK (mes_referencia BETWEEN 1 AND 12),
  ano_referencia SMALLINT NOT NULL,
  concessionaria TEXT NOT NULL,         -- SABESP, COMGAS, ENEL, "Outra: XXX"
  -- Datas (do proprio boleto)
  leitura_atual DATE,
  proxima_leitura DATE,
  vencimento DATE,
  -- Valor
  valor NUMERIC(12,2),
  -- Arquivo
  arquivo_url TEXT,                     -- path no bucket emissoes
  arquivo_nome TEXT,
  arquivo_hash TEXT,                    -- sha256 hex do PDF (deteccao duplicata)
  -- Meta
  descricao TEXT,
  marcada_repetida BOOLEAN DEFAULT false,
  status TEXT NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente', 'anexada')),
  -- Auditoria
  enviada_por UUID REFERENCES public.profiles(id),
  enviada_em TIMESTAMPTZ DEFAULT now(),
  anexada_por UUID REFERENCES public.profiles(id),
  anexada_em TIMESTAMPTZ,
  -- Origem (se foi duplicada de outra)
  origem_duplicacao UUID REFERENCES public.consumos_faturas(id) ON DELETE SET NULL
);

-- Um condo nao pode ter 2 faturas da mesma concessionaria no mesmo mes
CREATE UNIQUE INDEX IF NOT EXISTS uq_consumos_condo_periodo_conc
  ON public.consumos_faturas(condominio_id, ano_referencia, mes_referencia, concessionaria);

CREATE INDEX IF NOT EXISTS idx_consumos_condo
  ON public.consumos_faturas(condominio_id);

CREATE INDEX IF NOT EXISTS idx_consumos_periodo
  ON public.consumos_faturas(ano_referencia, mes_referencia);

CREATE INDEX IF NOT EXISTS idx_consumos_hash
  ON public.consumos_faturas(arquivo_hash)
  WHERE arquivo_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_consumos_status
  ON public.consumos_faturas(status);

-- RLS: padrao defensivo (autenticado pode tudo; logica fina no backend)
ALTER TABLE public.consumos_faturas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS consumos_faturas_all_authenticated ON public.consumos_faturas;
CREATE POLICY consumos_faturas_all_authenticated ON public.consumos_faturas
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

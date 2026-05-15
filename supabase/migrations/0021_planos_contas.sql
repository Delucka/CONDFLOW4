-- ==========================================
-- MIGRATION: Plano de Contas Contábeis (estilo Ahreas)
-- Cria estrutura hierárquica de planos com grupos, sintéticas e analíticas.
-- ==========================================

CREATE TABLE IF NOT EXISTS public.planos_contas (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo      VARCHAR(10) NOT NULL UNIQUE,    -- "0001", "0002", etc.
  nome        TEXT NOT NULL,                  -- "P. DE CONTAS PADRÃO"
  descricao   TEXT,
  ativo       BOOLEAN DEFAULT TRUE,
  criado_em   TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.planos_contas_itens (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plano_id          UUID NOT NULL REFERENCES public.planos_contas(id) ON DELETE CASCADE,
  parent_id         UUID REFERENCES public.planos_contas_itens(id) ON DELETE CASCADE,

  -- Códigos hierárquicos do Ahreas: ex "01.017 - 02"
  codigo_grupo      SMALLINT NOT NULL,        -- 01, 03, 04, ..., 99 (2 dígitos)
  codigo_subconta   SMALLINT NOT NULL,        -- 000, 001, 002, ... (3 dígitos)
  codigo_analitico  SMALLINT NOT NULL DEFAULT 0,  -- 00, 01, 02, ... (2 dígitos)

  -- Código reduzido (o que aparece em "Conta contábil" nos rateios)
  codigo_reduzido   INTEGER NOT NULL,

  nome              TEXT NOT NULL,
  -- null para grupos (1º grau), 'Sintética' ou 'Analítica' para itens
  natureza          TEXT CHECK (natureza IN ('Sintética','Analítica')),

  ordem             INTEGER DEFAULT 0,
  ativo             BOOLEAN DEFAULT TRUE,

  UNIQUE (plano_id, codigo_grupo, codigo_subconta, codigo_analitico)
);

CREATE INDEX IF NOT EXISTS idx_planos_itens_plano    ON public.planos_contas_itens(plano_id);
CREATE INDEX IF NOT EXISTS idx_planos_itens_parent   ON public.planos_contas_itens(parent_id);
CREATE INDEX IF NOT EXISTS idx_planos_itens_grupo    ON public.planos_contas_itens(plano_id, codigo_grupo, codigo_subconta);
CREATE INDEX IF NOT EXISTS idx_planos_itens_reduzido ON public.planos_contas_itens(plano_id, codigo_reduzido);
CREATE INDEX IF NOT EXISTS idx_planos_itens_nome     ON public.planos_contas_itens USING gin (to_tsvector('portuguese', nome));

-- RLS
ALTER TABLE public.planos_contas       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.planos_contas_itens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "planos_read_all"  ON public.planos_contas;
DROP POLICY IF EXISTS "planos_write_master" ON public.planos_contas;
DROP POLICY IF EXISTS "itens_read_all"   ON public.planos_contas_itens;
DROP POLICY IF EXISTS "itens_write_master" ON public.planos_contas_itens;

CREATE POLICY "planos_read_all" ON public.planos_contas FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "planos_write_master" ON public.planos_contas FOR ALL
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'master'));

CREATE POLICY "itens_read_all" ON public.planos_contas_itens FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "itens_write_master" ON public.planos_contas_itens FOR ALL
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'master'));

-- Liga condomínio ao plano
ALTER TABLE public.condominios
  ADD COLUMN IF NOT EXISTS plano_contas_id UUID REFERENCES public.planos_contas(id);

-- Em rateios_config: salva o item específico escolhido (sintética ou analítica)
ALTER TABLE public.rateios_config
  ADD COLUMN IF NOT EXISTS plano_item_id UUID REFERENCES public.planos_contas_itens(id);

-- ============================================================
-- Migração: Rateios Dinâmicos e Plano de Contas
-- Executar no Supabase SQL Editor
-- ============================================================

-- 1. Tabela de Planos de Contas
CREATE TABLE IF NOT EXISTS public.plano_contas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  plano INTEGER NOT NULL DEFAULT 1,         -- 1, 2, 3 ou 4
  conta TEXT NOT NULL,                       -- Ex: "01.000 - 00"
  nome TEXT NOT NULL,                        -- Ex: "ORDINÁRIA-COMUM"
  codigo_reduzido INTEGER,                   -- Ex: 12247
  tipo TEXT NOT NULL DEFAULT 'Receita',      -- "Receita", "Despesa" ou "Transferência"
  analitica_sintetica TEXT DEFAULT 'Sintética', -- "Analítica" ou "Sintética"
  grau INTEGER DEFAULT 1,                    -- 1 = pai, 2 = filha
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())
);

-- Índice para busca rápida por plano e tipo
CREATE INDEX IF NOT EXISTS idx_plano_contas_plano ON public.plano_contas(plano);
CREATE INDEX IF NOT EXISTS idx_plano_contas_tipo ON public.plano_contas(tipo);
CREATE INDEX IF NOT EXISTS idx_plano_contas_plano_tipo ON public.plano_contas(plano, tipo);

-- 2. Adicionar coluna plano_contas no condomínio (qual plano cada condo usa)
ALTER TABLE public.condominios
  ADD COLUMN IF NOT EXISTS plano_contas_id INTEGER DEFAULT 1
  CHECK (plano_contas_id BETWEEN 1 AND 4);

-- 3. Tabela de configuração de linhas da planilha (por processo)
CREATE TABLE IF NOT EXISTS public.rateios_config (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  processo_id UUID REFERENCES public.processos(id) ON DELETE CASCADE NOT NULL,
  ordem INTEGER NOT NULL DEFAULT 0,
  nome TEXT NOT NULL DEFAULT 'Novo Rateio',
  conta_contabil TEXT,  -- Código da conta contábil (ex: "01.003 - 00")
  conta_nome TEXT,      -- Nome da conta para exibição rápida
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_rateios_config_processo ON public.rateios_config(processo_id);

-- 4. Tabela de valores mensais dos rateios
CREATE TABLE IF NOT EXISTS public.rateios_valores (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  rateio_id UUID REFERENCES public.rateios_config(id) ON DELETE CASCADE NOT NULL,
  month INTEGER CHECK (month BETWEEN 1 AND 12),
  valor TEXT NOT NULL DEFAULT '0.00',  -- TEXT para aceitar "PLANILHA" etc.
  UNIQUE(rateio_id, month)
);

-- 5. RLS para novas tabelas
ALTER TABLE public.plano_contas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rateios_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rateios_valores ENABLE ROW LEVEL SECURITY;

-- Plano de contas: todos autenticados podem ler
CREATE POLICY "Todos podem ler plano_contas" ON public.plano_contas
  FOR SELECT USING (true);

-- Master pode gerenciar plano_contas
CREATE POLICY "Master gerencia plano_contas" ON public.plano_contas
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'master')
  );

-- Rateios: acesso vinculado ao processo (mesma lógica de arrecadacoes)
CREATE POLICY "Master vê todos rateios_config" ON public.rateios_config
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'master')
  );

CREATE POLICY "Gerente vê seus rateios_config" ON public.rateios_config
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.processos pr
      JOIN public.condominios c ON pr.condominio_id = c.id
      JOIN public.gerentes g ON c.gerente_id = g.id
      WHERE pr.id = public.rateios_config.processo_id AND g.profile_id = auth.uid()
    )
  );

CREATE POLICY "Gerente edita rateios_config em edição" ON public.rateios_config
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.processos pr
      JOIN public.condominios c ON pr.condominio_id = c.id
      JOIN public.gerentes g ON c.gerente_id = g.id
      WHERE pr.id = public.rateios_config.processo_id 
        AND g.profile_id = auth.uid() 
        AND pr.status = 'Em edição'
    )
  );

-- Rateios valores: mesma lógica
CREATE POLICY "Master vê todos rateios_valores" ON public.rateios_valores
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'master')
  );

CREATE POLICY "Gerente vê seus rateios_valores" ON public.rateios_valores
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.rateios_config rc
      JOIN public.processos pr ON rc.processo_id = pr.id
      JOIN public.condominios c ON pr.condominio_id = c.id
      JOIN public.gerentes g ON c.gerente_id = g.id
      WHERE rc.id = public.rateios_valores.rateio_id AND g.profile_id = auth.uid()
    )
  );

CREATE POLICY "Gerente edita rateios_valores em edição" ON public.rateios_valores
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.rateios_config rc
      JOIN public.processos pr ON rc.processo_id = pr.id
      JOIN public.condominios c ON pr.condominio_id = c.id
      JOIN public.gerentes g ON c.gerente_id = g.id
      WHERE rc.id = public.rateios_valores.rateio_id 
        AND g.profile_id = auth.uid() 
        AND pr.status = 'Em edição'
    )
  );

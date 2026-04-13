-- ==========================================
-- MIGRATION: Pacotes de Emissão (Multi-Arquivo)
-- Execute no SQL Editor do Supabase
-- ==========================================

-- 1. Tabela de Pacotes (agrupamento de arquivos por condomínio/mês)
CREATE TABLE IF NOT EXISTS public.emissoes_pacotes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  condominio_id UUID REFERENCES public.condominios(id) ON DELETE CASCADE NOT NULL,
  mes_referencia INTEGER CHECK (mes_referencia BETWEEN 1 AND 12),
  ano_referencia INTEGER NOT NULL,
  status TEXT DEFAULT 'rascunho',
  nivel_aprovacao TEXT,
  comentario_correcao TEXT,
  uploaded_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  criado_em TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
  atualizado_em TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
  UNIQUE(condominio_id, mes_referencia, ano_referencia)
);

-- 2. RLS
ALTER TABLE public.emissoes_pacotes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pacotes_all_authenticated" ON public.emissoes_pacotes FOR ALL
  USING (auth.role() = 'authenticated');

-- 3. Adicionar FK de pacote na tabela de arquivos existente
ALTER TABLE public.emissoes_arquivos ADD COLUMN IF NOT EXISTS pacote_id UUID REFERENCES public.emissoes_pacotes(id) ON DELETE CASCADE;

-- 4. Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.emissoes_pacotes;

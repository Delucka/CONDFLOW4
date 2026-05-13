-- ============================================================
-- SQL: Criação da Tabela de Emissões
-- Execute no SQL Editor do Supabase
-- ============================================================

CREATE TABLE IF NOT EXISTS public.emissoes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    condominio_id UUID NOT NULL REFERENCES public.condominios(id) ON DELETE CASCADE,
    mes_ano VARCHAR(10) NOT NULL, -- ex: "04/2026"
    tipo VARCHAR(50) NOT NULL,    -- ex: 'Boleto', 'Balancete', 'Relatório', 'Outros'
    nome_arquivo TEXT NOT NULL,
    storage_path TEXT NOT NULL,   -- Caminho dentro do bucket 'emissoes'
    tamanho_bytes BIGINT DEFAULT 0,
    criado_por UUID REFERENCES public.profiles(id),
    criado_em TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Habilitar RLS
ALTER TABLE public.emissoes ENABLE ROW LEVEL SECURITY;

-- Políticas de RLS
-- Apenas usuários autenticados (master e emissor) podem ver e inserir.
CREATE POLICY "Usuários autenticados veem emissoes" ON public.emissoes
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Usuários autenticados inserem emissoes" ON public.emissoes
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Usuários autenticados deletam emissoes" ON public.emissoes
  FOR DELETE USING (auth.role() = 'authenticated');

-- ============================================================
-- Políticas do Storage Bucket (se ainda não configurado para RLS)
-- ============================================================

-- Permite que usuários autenticados leiam arquivos do bucket
CREATE POLICY "Autenticados leem bucket emissoes" 
ON storage.objects FOR SELECT USING (bucket_id = 'emissoes' AND auth.role() = 'authenticated');

-- Permite que usuários autenticados enviem (upload)
CREATE POLICY "Autenticados inserem no bucket emissoes" 
ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'emissoes' AND auth.role() = 'authenticated');

-- Permite que usuários autenticados apaguem arquivos
CREATE POLICY "Autenticados apagam do bucket emissoes" 
ON storage.objects FOR DELETE USING (bucket_id = 'emissoes' AND auth.role() = 'authenticated');

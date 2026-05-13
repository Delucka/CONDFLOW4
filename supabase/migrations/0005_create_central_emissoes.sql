-- ==========================================
-- SCRIPT: CENTRAL DE EMISSÕES (Supabase)
-- ==========================================

-- 1. Enums para a Central de Emissões
CREATE TYPE public.emissao_tipo AS ENUM ('emissao', 'cobranca_extra');
CREATE TYPE public.emissao_status AS ENUM ('pendente', 'aprovado', 'solicitar_correcao');

-- 2. Tabela de Emissões e Arquivos
CREATE TABLE public.emissoes_arquivos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  condominio_id UUID REFERENCES public.condominios(id) ON DELETE CASCADE NOT NULL,
  tipo public.emissao_tipo NOT NULL,
  arquivo_url TEXT NOT NULL,
  arquivo_nome TEXT NOT NULL,
  formato TEXT NOT NULL,
  mes_referencia INTEGER CHECK (mes_referencia BETWEEN 1 AND 12),
  ano_referencia INTEGER NOT NULL,
  status public.emissao_status DEFAULT 'pendente',
  comentario_correcao TEXT,
  uploaded_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  criado_em TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
  atualizado_em TIMESTAMPTZ DEFAULT timezone('utc'::text, now())
);

-- Habilitar Realtime para envios de notificações e badges de Dashboard
alter publication supabase_realtime add table public.emissoes_arquivos;

-- 3. Habilitando RLS na nova tabela
ALTER TABLE public.emissoes_arquivos ENABLE ROW LEVEL SECURITY;

-- 4. POLÍTICAS RLS PARA A TABELA 'emissoes_arquivos'

-- [MASTER/SUPERVISORA]: Vê tudo e altera tudo
CREATE POLICY "Emissoes - Master e Supervisora enxergam/alteram tudo" 
  ON public.emissoes_arquivos FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('master', 'supervisora'))
  );

-- [GERENTE]: Vê e Edita apenas da sua carteira (via condominios -> gerentes)
CREATE POLICY "Emissoes - Gerente ve e altera sua carteira" 
  ON public.emissoes_arquivos FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.condominios c
      JOIN public.gerentes g ON c.gerente_id = g.id
      WHERE c.id = public.emissoes_arquivos.condominio_id AND g.profile_id = auth.uid()
    )
  );

-- [DEPARTAMENTO] (Emissor): Vê apenas o que ele próprio enviou e pode INSERIR/EDITAR
CREATE POLICY "Emissoes - Departamento gerencia seus envios" 
  ON public.emissoes_arquivos FOR ALL USING (
    uploaded_by = auth.uid() OR 
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'departamento')
  );

-- Garantir que o DEPARTAMENTO (Emissor) verifique condomínios para selecionar na tela de envio
CREATE POLICY "Departamento ve condominios" ON public.condominios FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'departamento')
);

-- ==========================================
-- SCRIPT DE STORAGE ROBUSTO
-- ==========================================

-- 1. Forçar a criação do Bucket "emissoes" em formato privado (seguro por padrão)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) 
VALUES (
  'emissoes', 
  'emissoes', 
  false, 
  52428800, -- Limite de 50MB por padrão
  ARRAY['image/jpeg', 'image/png', 'application/pdf', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel']
)
ON CONFLICT (id) DO UPDATE SET 
  public = false,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'application/pdf', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'];

-- 2. Limpar políticas antigas se existirem (para evitar dupla regra conflitante)
DROP POLICY IF EXISTS "INSERT para usuários autenticados" ON storage.objects;
DROP POLICY IF EXISTS "SELECT para usuários autenticados" ON storage.objects;
DROP POLICY IF EXISTS "UPDATE e DELETE apenas para uploader ou master" ON storage.objects;
DROP POLICY IF EXISTS "DELETE apenas para uploader ou master" ON storage.objects;
DROP POLICY IF EXISTS "Emisssões Storage: Autenticados podem Inserir" ON storage.objects;
DROP POLICY IF EXISTS "Emisssões Storage: Autenticados podem Ler (Visualizar/Download)" ON storage.objects;
DROP POLICY IF EXISTS "Emisssões Storage: Autenticados podem Atualizar" ON storage.objects;
DROP POLICY IF EXISTS "Emisssões Storage: Autenticados podem Apagar" ON storage.objects;

-- 3. Inserir (Upload): Somente autenticados (Emissor/Gerente)
CREATE POLICY "INSERT para usuários autenticados"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'emissoes');

-- 4. Selecionar/Visualizar: Todos os autenticados podem ver os arquivos (pois a base limita qual arquivo visualizarão)
CREATE POLICY "SELECT para usuários autenticados"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'emissoes');

-- 5. Modificar (Update): Apenas o owner (quem criou arquivo físico) ou Master
CREATE POLICY "UPDATE e DELETE apenas para uploader ou master"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'emissoes' 
  AND (
    auth.uid() = owner -- Compara quem upou
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'master')
  )
);

-- 6. Deletar (Delete): IDEM ao update, apenas criador e Masters
CREATE POLICY "DELETE apenas para uploader ou master"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'emissoes' 
  AND (
    auth.uid() = owner
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'master')
  )
);

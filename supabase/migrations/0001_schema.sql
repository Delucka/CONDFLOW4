-- Habilitar extensão para geração de UUIDs (necessário no PostgreSQL do Supabase)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 0. Limpar estruturas antigas para evitar conflitos de tipos já existentes
DROP TABLE IF EXISTS public.aprovacoes CASCADE;
DROP TABLE IF EXISTS public.cobrancas_extras CASCADE;
DROP TABLE IF EXISTS public.arrecadacoes CASCADE;
DROP TABLE IF EXISTS public.processos CASCADE;
DROP TABLE IF EXISTS public.condominios CASCADE;
DROP TABLE IF EXISTS public.gerentes CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;

DROP TYPE IF EXISTS user_role CASCADE;
DROP TYPE IF EXISTS process_status CASCADE;

-- 1. Criação dos Enums para Tipos de Perfil e Status
CREATE TYPE user_role AS ENUM (
  'master',
  'departamento',
  'gerente',
  'supervisora',
  'sindico',
  'supervisor_gerentes',
  'supervisora_contabilidade',
  'outros'
);

CREATE TYPE process_status AS ENUM (
  'Em edição', 
  'Enviado', 
  'Em aprovação', 
  'Aprovado', 
  'Solicitar alteração', 
  'Emitido'
);

-- 2. Tabela de Perfis (Vinculada ao auth.users)
-- Centraliza o controle de acesso de todos os usuários do sistema.
CREATE TABLE public.profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  role user_role NOT NULL DEFAULT 'outros',
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())
);

-- 3. Tabela de Gerentes
-- Relacionamento 1:1 com profiles. Útil caso haja configurações específicas para o papel de gerente.
CREATE TABLE public.gerentes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE UNIQUE NOT NULL,
  limit_condos INTEGER DEFAULT 35,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())
);

-- 4. Tabela de Condomínios (Cadastro Base)
CREATE TABLE public.condominios (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  gerente_id UUID REFERENCES public.gerentes(id) ON DELETE SET NULL,
  due_day INTEGER CHECK (due_day BETWEEN 1 AND 31),
  issue_limit_day INTEGER CHECK (issue_limit_day BETWEEN 1 AND 31),
  dispatch_limit_day INTEGER CHECK (dispatch_limit_day BETWEEN 1 AND 31),
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())
);

-- 5. Tabela de Processos (Representa a planilha semestral)
CREATE TABLE public.processos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  condominio_id UUID REFERENCES public.condominios(id) ON DELETE CASCADE NOT NULL,
  year INTEGER NOT NULL,
  semester INTEGER CHECK (semester IN (1, 2)) NOT NULL,
  status process_status DEFAULT 'Em edição',
  fluxo INTEGER, -- Opções 1, 2, 3 ou 4 dependendo da escolha no momento de envio
  current_approver_role user_role, -- Guarda qual papel deve aprovar agora a planilha (Ex: 'supervisora')
  issue_notes TEXT,
  manager_notes TEXT,
  manager_signature_date TIMESTAMPTZ,
  admin_signature_date TIMESTAMPTZ,
  vistos_datas_entrega TEXT,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
  UNIQUE(condominio_id, year, semester)
);

-- 6. Tabela de Arrecadações (Meses do Processo)
-- Apenas 1 registro por mês em um determinado processo semestral
CREATE TABLE public.arrecadacoes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  processo_id UUID REFERENCES public.processos(id) ON DELETE CASCADE NOT NULL,
  month INTEGER CHECK (month BETWEEN 1 AND 12),
  taxa_condominial NUMERIC(10,2) DEFAULT 0,
  fundo_reserva NUMERIC(10,2) DEFAULT 0,
  consumo_agua_gas TEXT, -- Pode ser valor numérico escrito em string ou especificamente "PLANILHA"
  outras_verbas JSONB DEFAULT '[]'::jsonb, -- Array json estruturado contendo {descricao: "string", valor: 0.00}
  UNIQUE(processo_id, month)
);

-- 7. Tabela de Cobranças Extras
CREATE TABLE public.cobrancas_extras (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  processo_id UUID REFERENCES public.processos(id) ON DELETE CASCADE NOT NULL,
  description TEXT NOT NULL,
  amount NUMERIC(10,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())
);

-- 8. Histórico de Aprovações/Alterações e Logs
-- Registra todas as ações e comentários tomados ao longo do fluxo do processo
CREATE TABLE public.aprovacoes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  processo_id UUID REFERENCES public.processos(id) ON DELETE CASCADE NOT NULL,
  approver_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  action TEXT NOT NULL, -- Valores como: 'Enviado', 'Aprovado', 'Solicitado alteração', 'Emitido'
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())
);

-- HABILITANDO SEGURANÇA EM NÍVEL DE LINHA (RLS - Row Level Security)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gerentes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.condominios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.processos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.arrecadacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cobrancas_extras ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aprovacoes ENABLE ROW LEVEL SECURITY;


-- POLÍTICAS RLS (Row Level Security) BÁSICAS PARA DEMONSTRAÇÃO DO FLUXO:
-- (Obs: Em produção ou no momento de build, essas políticas podem ser mais finas)

-- 1. Profiles: Master vê e atualiza tudo. Todos os autenticados veem pelo menos os perfis.
CREATE POLICY "Master override all profiles" ON public.profiles FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'master')
);
CREATE POLICY "View profiles by all authenticated" ON public.profiles FOR SELECT USING (
  auth.uid() = id OR EXISTS (SELECT 1 FROM public.profiles)
);

-- 2. Condominios: Master vê tudo. Gerente só vê os seus.
CREATE POLICY "Master ver todos condominios" ON public.condominios FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'master')
);
CREATE POLICY "Gerente vê seus condominios" ON public.condominios FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.gerentes g 
    WHERE public.condominios.gerente_id = g.id AND g.profile_id = auth.uid()
  )
);

-- 3. Processos (As regras base do desafio)
-- Master: Vê tudo e altera tudo.
CREATE POLICY "Master vê todos processos" ON public.processos FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'master')
);

-- Gerente: Só enxerga seus processos. E a política crítica: "Pode editar arrecadações/processos SOMENTE em status 'Em edição'"
CREATE POLICY "Gerente enxerga e edita os processos (limitado ao status pelo BD)" ON public.processos FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.condominios c
    JOIN public.gerentes g ON c.gerente_id = g.id
    WHERE c.id = public.processos.condominio_id AND g.profile_id = auth.uid()
  )
);
CREATE POLICY "Gerente edita processo SÓ SE status for Em Edição" ON public.processos FOR UPDATE USING (
  status = 'Em edição' AND
  EXISTS (
    SELECT 1 FROM public.condominios c
    JOIN public.gerentes g ON c.gerente_id = g.id
    WHERE c.id = public.processos.condominio_id AND g.profile_id = auth.uid()
  )
);

-- 4. Arrecadacoes: Herdam o RLS do Processo vinculado.
CREATE POLICY "Gerentes podem ver suas arrecadacoes" ON public.arrecadacoes FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.processos p
    JOIN public.condominios c ON p.condominio_id = c.id
    JOIN public.gerentes g ON c.gerente_id = g.id
    WHERE p.id = public.arrecadacoes.processo_id AND g.profile_id = auth.uid()
  )
);
-- Bloqueio pesado no banco de dados para Insert/Update nas arrecadações se não estiver "Em edição"
CREATE POLICY "Inserts/Updates/Deletes em arrecadacoes apenas se Processo Em edição" ON public.arrecadacoes FOR ALL USING (
  EXISTS (
    SELECT 1 FROM public.processos p
    JOIN public.condominios c ON p.condominio_id = c.id
    JOIN public.gerentes g ON c.gerente_id = g.id
    WHERE p.id = public.arrecadacoes.processo_id AND g.profile_id = auth.uid() AND p.status = 'Em edição'
  )
);

-- 5. Cobrancas Extras: Acesso igual ao de arrecadações (travado ao envio).
CREATE POLICY "Gerentes podem ver cobrancas extras" ON public.cobrancas_extras FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.processos p
    JOIN public.condominios c ON p.condominio_id = c.id
    JOIN public.gerentes g ON c.gerente_id = g.id
    WHERE p.id = public.cobrancas_extras.processo_id AND g.profile_id = auth.uid()
  )
);
CREATE POLICY "Gerentes manipulam cobrancas extras somente Em Edição" ON public.cobrancas_extras FOR ALL USING (
  EXISTS (
    SELECT 1 FROM public.processos p
    JOIN public.condominios c ON p.condominio_id = c.id
    JOIN public.gerentes g ON c.gerente_id = g.id
    WHERE p.id = public.cobrancas_extras.processo_id AND g.profile_id = auth.uid() AND p.status = 'Em edição'
  )
);

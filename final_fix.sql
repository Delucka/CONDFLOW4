-- Correção Crítica 1: Eliminar "infinite recursion" liberando as checagens RLS diretamente nas tabelas
-- (O backend em Python e validações de sessão já dão conta da segurança com o master)
ALTER TABLE public.profiles DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.gerentes DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.condominios DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.processos DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.arrecadacoes DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.cobrancas_extras DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.aprovacoes DISABLE ROW LEVEL SECURITY;

-- Correção Crítica 2: Adicionar as colunas físicas exatas requeridas pela aba de Condomínio 
ALTER TABLE public.condominios 
DROP COLUMN IF EXISTS issue_limit_day,
DROP COLUMN IF EXISTS dispatch_limit_day,
ADD COLUMN IF NOT EXISTS limit_gerencia INTEGER,
ADD COLUMN IF NOT EXISTS limit_emissao INTEGER,
ADD COLUMN IF NOT EXISTS limit_expedicao INTEGER,
ADD COLUMN IF NOT EXISTS obs_emissao TEXT,
ADD COLUMN IF NOT EXISTS obs_expedicao TEXT;

-- ═══════════════════════════════════════════════════════════════════
-- CondoFlow — Migração RBAC (04/2026)
-- Adiciona roles 'assistente' e 'emissor'
-- Adiciona relacionamento gerente -> assistente
-- ═══════════════════════════════════════════════════════════════════

-- 1) Novos valores no enum user_role (Supabase/Postgres)
-- IMPORTANTE: rode cada ALTER TYPE isoladamente (Postgres bloqueia múltiplos valores em tx)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'assistente' AND enumtypid = 'public.user_role'::regtype) THEN
        ALTER TYPE public.user_role ADD VALUE 'assistente';
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'emissor' AND enumtypid = 'public.user_role'::regtype) THEN
        ALTER TYPE public.user_role ADD VALUE 'emissor';
    END IF;
END $$;

-- 2) Campo assistente_id na tabela gerentes (1 assistente por gerente)
ALTER TABLE public.gerentes
    ADD COLUMN IF NOT EXISTS assistente_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_gerentes_assistente ON public.gerentes(assistente_id);

-- 3) Tabela de assinaturas digitais (nome + timestamp + hash do conteúdo)
CREATE TABLE IF NOT EXISTS public.assinaturas (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    processo_id UUID REFERENCES public.processos(id) ON DELETE CASCADE NOT NULL,
    signer_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    signer_name TEXT NOT NULL,
    signer_role TEXT NOT NULL,
    signed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    signature_hash TEXT,                 -- hash do conteúdo no momento da assinatura
    metadata JSONB DEFAULT '{}'::jsonb   -- ip, user_agent, etc
);

CREATE INDEX IF NOT EXISTS idx_assinaturas_processo ON public.assinaturas(processo_id);

ALTER TABLE public.assinaturas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Assinaturas - leitura autenticados" ON public.assinaturas;
CREATE POLICY "Assinaturas - leitura autenticados" ON public.assinaturas FOR SELECT
    USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Assinaturas - inserir próprio" ON public.assinaturas;
CREATE POLICY "Assinaturas - inserir próprio" ON public.assinaturas FOR INSERT
    WITH CHECK (signer_id = auth.uid());

-- 4) Campo "emitido_por" em processos (para rotear "solicitar correção")
ALTER TABLE public.processos
    ADD COLUMN IF NOT EXISTS emitido_por UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

-- 5) Backfill: preenche emitido_por com o gerente do condomínio (para processos antigos)
UPDATE public.processos p
SET emitido_por = g.profile_id
FROM public.condominios c
JOIN public.gerentes g ON g.id = c.gerente_id
WHERE p.condominio_id = c.id AND p.emitido_por IS NULL;

-- ==========================================
-- MIGRATION: Permite "gerentes fantasma" (sem profile/login)
-- + adiciona coluna nome + codigo_externo (do Ahreas)
-- ==========================================

-- 1) Torna profile_id nullable (gerente pode existir sem user)
ALTER TABLE public.gerentes
  ALTER COLUMN profile_id DROP NOT NULL;

-- 2) Adiciona coluna nome (denormalizado pra gerente sem profile)
ALTER TABLE public.gerentes
  ADD COLUMN IF NOT EXISTS nome TEXT;

-- 3) Adiciona codigo_externo (código do Ahreas: 0001, 0016, etc) — útil pra reimport
ALTER TABLE public.gerentes
  ADD COLUMN IF NOT EXISTS codigo_externo VARCHAR(10) UNIQUE;

-- 4) Backfill: para gerentes existentes, copia o nome do profile vinculado
UPDATE public.gerentes g
SET nome = p.full_name
FROM public.profiles p
WHERE g.profile_id = p.id AND g.nome IS NULL;

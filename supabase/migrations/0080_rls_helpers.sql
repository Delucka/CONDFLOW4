-- ============================================================
-- 0080 — Funções de apoio para as políticas de RLS
-- ============================================================
-- POR QUÊ: a 0073 (rateios) repetiu o mesmo JOIN de carteira quatro vezes, uma
-- vez por política. Cada tabela nova multiplicaria essa repetição — e um erro em
-- qualquer cópia abre um buraco silencioso. Aqui a regra fica escrita UMA vez.
--
-- SECURITY DEFINER é obrigatório, não conveniência: a política precisa ler
-- `profiles`, `gerentes` e `condominios`. Se um dia essas tabelas ganharem RLS,
-- uma função comum entraria em recursão infinita (a política de profiles
-- chamando a função que lê profiles). DEFINER quebra o ciclo.
--
-- `search_path` fixo em `public` fecha o vetor clássico de sequestro de schema
-- em função DEFINER.
--
-- ⚠️ ROLLBACK:
--   DROP FUNCTION IF EXISTS public.condominios_da_carteira();
--   DROP FUNCTION IF EXISTS public.papel_atual();
-- ============================================================

-- ── Papel do usuário logado ──
-- Devolve NULL para quem não tem profile (não deve acontecer, mas política
-- nenhuma pode explodir por isso — comparação com NULL simplesmente nega acesso).
CREATE OR REPLACE FUNCTION public.papel_atual()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.role::text FROM public.profiles p WHERE p.id = auth.uid();
$$;

-- ── Condomínios que o usuário logado pode tocar ──
-- Duas origens, conforme a 0057 documenta:
--   gerente    → a própria carteira        (gerentes.profile_id → gerentes.id → condominios.gerente_id)
--   assistente → a carteira do SEU gerente (profiles.gerente_id guarda o PROFILE do gerente,
--                não o gerentes.id — é a Armadilha 2 do docs/ESQUEMA-BANCO.md)
-- Para os demais papéis devolve vazio; quem tem alcance global é tratado por
-- papel na política, não por esta função.
CREATE OR REPLACE FUNCTION public.condominios_da_carteira()
RETURNS TABLE (condominio_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id
    FROM public.condominios c
    JOIN public.gerentes    g ON c.gerente_id = g.id
   WHERE g.profile_id = auth.uid()
  UNION
  SELECT c.id
    FROM public.condominios c
    JOIN public.gerentes    g ON c.gerente_id = g.id
    JOIN public.profiles    p ON p.gerente_id = g.profile_id
   WHERE p.id = auth.uid() AND p.role::text = 'assistente';
$$;

REVOKE ALL ON FUNCTION public.papel_atual()              FROM PUBLIC;
REVOKE ALL ON FUNCTION public.condominios_da_carteira()  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.papel_atual()             TO authenticated;
GRANT EXECUTE ON FUNCTION public.condominios_da_carteira() TO authenticated;

-- ── Conferência ──
-- Logado como um gerente, deve listar só a carteira dele:
--   SELECT public.papel_atual();
--   SELECT count(*) FROM public.condominios_da_carteira();

-- ============================================================
-- 0085 — Fecha `profiles` — ESCALAÇÃO DE PRIVILÉGIO
-- ============================================================
-- O BURACO: com o RLS desligado (desde a 0018), qualquer usuário logado pode,
-- pelo DevTools com a chave anon:
--
--     UPDATE profiles SET role = 'master' WHERE id = <o próprio>;
--
-- Ou seja: qualquer gerente, assistente ou síndico vira master em uma linha, e
-- daí alcança tudo. É a falha mais grave desta série inteira — pior que apagar
-- cobrança, porque dá acesso a todo o resto.
--
-- ── Por que a leitura fica ABERTA (e não é preguiça) ──
-- A primeira versão desta migration restringia a leitura por papel, chamando
-- papel_atual(). Estourou no ensaio com:
--
--     42P17: infinite recursion detected in policy for relation "profiles"
--
-- E é insolúvel por esse caminho: para saber se você PODE ler profiles, a
-- política precisa saber o seu papel — que está em profiles. A política chama a
-- si mesma. SECURITY DEFINER não resolveu na prática.
--
-- Então: leitura liberada a quem está logado. É o mesmo nível de exposição de
-- hoje (nome, e-mail e papel de colegas — que a própria interface já exibe nas
-- telas de carteira e auditoria), e nenhuma linha de proteção é perdida em
-- relação ao estado atual.
--
-- ── O que MUDA de verdade ──
-- A escrita, que é onde estava o perigo:
--
--   INSERT / DELETE     negados (nenhuma policy os cobre)
--   UPDATE              só a PRÓPRIA linha (RLS)
--                       e só as DUAS COLUNAS do reset de senha (GRANT de coluna)
--
-- RLS não filtra coluna — por isso o GRANT de coluna entra junto. Sem ele,
-- "atualizar a própria linha" ainda permitiria trocar o próprio `role`, e o
-- buraco continuaria aberto.
--
-- Conferido antes de escrever: o navegador só escreve em profiles no
-- reset-password (must_change_password + password_changed_at, no próprio
-- registro). /admin/usuarios administra pelo BACKEND, com service-role, que
-- ignora RLS e não é afetado.
--
-- ⚠️ ROLLBACK — DEIXE COLADO NOUTRA ABA ANTES DE RODAR:
--   ALTER TABLE public.profiles DISABLE ROW LEVEL SECURITY;
--   GRANT UPDATE ON public.profiles TO authenticated;
-- ============================================================

-- Apaga TODAS as policies existentes, sem depender de adivinhar nome.
-- Adivinhar foi o que causou a segunda recursão: sobrou uma política antiga em
-- `profiles`, com nome que eu não previ, chamando algo que relia a tabela.
DO $limpa$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT policyname FROM pg_policies
            WHERE schemaname='public' AND tablename='profiles'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.profiles', r.policyname);
  END LOOP;
END $limpa$;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- ══════════════ Leitura ══════════════
-- Sem chamada de função: é o que evita a recursão.
CREATE POLICY "profiles_leitura" ON public.profiles
  FOR SELECT TO authenticated
  USING (true);

-- ══════════════ Atualização — só a própria linha ══════════════
-- Sem policy de INSERT/DELETE: ambos ficam negados pela chave anon.
CREATE POLICY "profiles_atualiza_o_proprio" ON public.profiles
  FOR UPDATE TO authenticated
  USING      (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- ══════════════ Trava de coluna — o que fecha a escalação ══════════════
-- RLS diz QUAIS LINHAS; isto diz QUAIS COLUNAS. Sem esta parte, o usuário ainda
-- trocaria o próprio `role` na própria linha.
REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT  UPDATE (must_change_password, password_changed_at)
  ON public.profiles TO authenticated;

-- ── Conferência ──
-- 1. Recarregue com Ctrl+Shift+R — ainda entra?
-- 2. LOGOUT e login completo (o passo 1 pode passar com sessão em cache)
-- 3. /admin/usuarios — a lista carrega? (é leitura; a escrita é pelo backend)
-- 4. A prova de que fechou — logado como NÃO-master, no console do navegador:
--       await supabase.from('profiles').update({role:'master'}).eq('id', <seu id>)
--    Tem de falhar. Antes desta migration, funcionava.

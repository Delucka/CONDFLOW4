-- ============================================================
-- 0085 — Fecha `profiles`  ⚠️ A MAIS PERIGOSA DAS SEIS
-- ============================================================
-- LEIA ANTES DE RODAR. Esta é a única migration desta série que, se estiver
-- errada, TRANCA VOCÊ PARA FORA DO SISTEMA.
--
-- Motivo: `profiles` é lida no login (lib/auth.js:16, `select * where id = uid`).
-- Se a política negar essa leitura, o AuthProvider não resolve o papel, o
-- RouteGuard não libera nada, e ninguém entra — nem o master. E o rollback
-- exige o SQL Editor, não a aplicação.
--
-- Por isso: rode com o SQL Editor ABERTO NOUTRA ABA, com a linha de rollback já
-- colada e pronta para executar. Não rode com gerente trabalhando.
--
-- ── O que a aplicação faz com esta tabela ──
--   lib/auth.js:16          SELECT * WHERE id = <o próprio>     ← LOGIN
--   reset-password:42       UPDATE must_change_password         ← o próprio
--   FilaOcorrencias:59      SELECT (nomes, para exibir)
--   backend                 service-role — ignora RLS, não afetado
--
-- ── Modelo ──
--   leitura  todo usuário logado lê a PRÓPRIA linha, sempre. Master,
--            departamento e supervisores leem todas (as telas mostram nome de
--            gerente e de assistente). Gerente lê também os assistentes ligados
--            a ele (profiles.gerente_id = o profile dele), que é o que a tela de
--            carteira precisa.
--   escrita  a própria linha (é o que o reset-password faz) e master (que
--            administra usuários em /admin/usuarios).
--
-- A leitura da própria linha vem PRIMEIRO na condição e não depende de função
-- nenhuma — é `id = auth.uid()`, puro. Assim, mesmo que papel_atual() falhe por
-- qualquer motivo, o login continua de pé.
--
-- Não usamos papel_atual() aqui por precaução extra: ela é SECURITY DEFINER e lê
-- `profiles`. Com RLS ligado nesta tabela, o DEFINER quebra o ciclo — mas manter
-- a regra do próprio usuário independente de função elimina a dúvida de vez.
--
-- ⚠️ ROLLBACK — DEIXE ESTA LINHA COLADA E PRONTA ANTES DE RODAR:
--   ALTER TABLE public.profiles DISABLE ROW LEVEL SECURITY;
-- ============================================================

DROP POLICY IF EXISTS "profiles_all_authenticated" ON public.profiles;
DROP POLICY IF EXISTS "Allow all auth users"       ON public.profiles;
DROP POLICY IF EXISTS "Usuario ve o proprio perfil" ON public.profiles;
DROP POLICY IF EXISTS "profiles_leitura"           ON public.profiles;
DROP POLICY IF EXISTS "profiles_escrita"           ON public.profiles;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- ══════════════ Leitura ══════════════
CREATE POLICY "profiles_leitura" ON public.profiles
  FOR SELECT TO authenticated
  USING (
    id = auth.uid()                              -- o próprio: garante o LOGIN
    OR public.papel_atual() IN (
         'master', 'departamento',
         'supervisora', 'supervisora_contabilidade', 'supervisor_gerentes'
       )
    OR gerente_id = auth.uid()                   -- gerente lê seus assistentes
  );

-- ══════════════ Escrita ══════════════
CREATE POLICY "profiles_escrita" ON public.profiles
  FOR ALL TO authenticated
  USING      (id = auth.uid() OR public.papel_atual() = 'master')
  WITH CHECK (id = auth.uid() OR public.papel_atual() = 'master');

-- ── Conferência ──
-- ANTES de fechar a aba, teste NESTA ORDEM:
--   1. Recarregue o site com Ctrl+Shift+R. Ainda entra?  ← se não, ROLLBACK JÁ
--   2. Saia e entre de novo (logout + login completo)
--   3. Abra /admin/usuarios — a lista de usuários carrega?
--   4. Painel Central — os nomes de gerente aparecem nas linhas?
--
-- Só considere aplicada depois do passo 2. O passo 1 pode passar com a sessão
-- em cache e esconder o problema.

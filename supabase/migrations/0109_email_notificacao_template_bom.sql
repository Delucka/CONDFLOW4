-- ============================================================================
-- 0109 — O e-mail da notificação passa a usar o template da marca
-- ============================================================================
--
-- O QUE ESTAVA ERRADO. Existem DOIS visuais de e-mail no sistema, e o pior é o
-- que mais sai:
--
--   • `email_template` (0079) — cabeçalho navy, logo Vizinhança, rodapé da Prop
--     Starter com telefone e endereço. Usado no convite de acesso e na
--     recuperação de senha, que saem algumas vezes por mês.
--
--   • o HTML embutido em `email_da_notificacao` (0051) — cabeçalho roxo
--     #6d28d9, sem logo, com o botão apontando para
--     `condominios-gamma.vercel.app`. Usado em TODA notificação, que é o que o
--     gerente recebe toda semana.
--
-- Ou seja: o e-mail mais visto era o único fora da marca, e mandava para o
-- domínio antigo.
--
-- `email_html` é a segunda parte. O sino mostra `mensagem` como texto puro — pôr
-- HTML nela encheria a tela de tags. Então a notificação passa a poder carregar
-- uma versão rica SÓ para o e-mail: o sino continua com a linha curta, o e-mail
-- ganha os blocos. Quando `email_html` é nula, o e-mail usa a mensagem, como
-- sempre fez.
-- ============================================================================

ALTER TABLE public.notificacoes
  ADD COLUMN IF NOT EXISTS email_html TEXT;

COMMENT ON COLUMN public.notificacoes.email_html IS
  'Corpo rico só para o e-mail. Nulo = usa `mensagem`. O sino sempre usa `mensagem`, que é texto puro.';


CREATE OR REPLACE FUNCTION public.email_da_notificacao()
RETURNS TRIGGER AS $$
DECLARE
  v_email text;
  v_corpo text;
  v_html  text;
BEGIN
  SELECT coalesce(
    (SELECT g.notificacao_email FROM public.gerentes g
       WHERE g.profile_id = NEW.user_id
         AND g.notificacao_email IS NOT NULL AND g.notificacao_email <> '' LIMIT 1),
    (SELECT p.notificacao_email FROM public.profiles p
       WHERE p.id = NEW.user_id
         AND p.notificacao_email IS NOT NULL AND p.notificacao_email <> ''),
    (SELECT email FROM public.profiles WHERE id = NEW.user_id)
  ) INTO v_email;

  IF v_email IS NULL OR v_email = '' THEN RETURN NEW; END IF;

  -- Rico quando existe; texto puro quando não. `email_template` cuida do
  -- cabeçalho, do botão e do rodapé — e do domínio certo, que agora está num
  -- lugar só em vez de repetido aqui dentro.
  v_corpo := coalesce(
    NEW.email_html,
    '<p style="margin:0;">' || coalesce(NEW.mensagem, '') || '</p>'
  );

  v_html := public.email_template(
    coalesce(NEW.titulo, 'Notificação'),
    v_corpo,
    coalesce(NEW.link, '/dashboard')
  );

  PERFORM public.enviar_email(v_email, coalesce(NEW.titulo, 'Notificação CondoFlow'), v_html);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================================
-- CONFERIR (rode depois)
-- ============================================================================
-- O corpo montado para a última notificação, sem enviar nada:
--
-- SELECT public.email_template(titulo, coalesce(email_html, mensagem), link)
--   FROM notificacoes ORDER BY created_at DESC LIMIT 1;
--
-- E que ninguém mais aponta para o domínio antigo:
-- SELECT prosrc LIKE '%condominios-gamma%' AS ainda_aponta_pro_antigo
--   FROM pg_proc WHERE proname = 'email_da_notificacao';


-- ============================================================================
-- REVERTER — volta ao HTML roxo embutido (0051)
-- ============================================================================
-- Está em supabase/migrations/0051_notificacao_email_todos.sql, função
-- `email_da_notificacao`. Rodar aquele trecho restaura o comportamento antigo.
-- A coluna `email_html` pode ficar: nula, ela não muda nada.

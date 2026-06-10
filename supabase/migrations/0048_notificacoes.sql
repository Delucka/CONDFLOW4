-- ==========================================
-- MIGRATION 0048: Sistema de notificações (in-app)
-- Tabela + RLS + gatilho que cria notificações nos eventos da emissão.
-- (E-mail será plugado depois, quando o provedor for definido.)
-- ==========================================

CREATE TABLE IF NOT EXISTS public.notificacoes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  tipo       TEXT,
  titulo     TEXT NOT NULL,
  mensagem   TEXT,
  link       TEXT,
  lida       BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notif_user
  ON public.notificacoes(user_id, lida, created_at DESC);

ALTER TABLE public.notificacoes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notif_select ON public.notificacoes;
CREATE POLICY notif_select ON public.notificacoes FOR SELECT USING (user_id = auth.uid());
DROP POLICY IF EXISTS notif_update ON public.notificacoes;
CREATE POLICY notif_update ON public.notificacoes FOR UPDATE USING (user_id = auth.uid());
DROP POLICY IF EXISTS notif_delete ON public.notificacoes;
CREATE POLICY notif_delete ON public.notificacoes FOR DELETE USING (user_id = auth.uid());

-- Realtime (atualiza o sino ao vivo). Seguro se já estiver na publicação.
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.notificacoes;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_object THEN NULL; END $$;

-- ---------- Gatilho: cria notificações na mudança de status da emissão ----------
CREATE OR REPLACE FUNCTION public.notificar_emissao()
RETURNS TRIGGER AS $$
DECLARE
  st         text := lower(coalesce(NEW.status, ''));
  condo_nome text;
  periodo    text := lpad(coalesce(NEW.mes_referencia, 0)::text, 2, '0') || '/' || coalesce(NEW.ano_referencia, 0)::text;
BEGIN
  -- Só age quando o status realmente muda
  IF TG_OP = 'UPDATE' AND coalesce(OLD.status, '') = coalesce(NEW.status, '') THEN
    RETURN NEW;
  END IF;

  SELECT name INTO condo_nome FROM public.condominios WHERE id = NEW.condominio_id;
  condo_nome := coalesce(condo_nome, 'Condomínio');

  -- 1) Aguardando aprovação do GERENTE -> notifica o gerente do condomínio
  IF st LIKE '%aguardando gerente%' OR st = 'pendente_gerente' THEN
    INSERT INTO public.notificacoes (user_id, tipo, titulo, mensagem, link)
    SELECT g.profile_id, 'emissao_aprovacao',
           'Emissão aguardando sua aprovação',
           condo_nome || ' · ' || periodo || ' — precisa da sua conferência.',
           '/aprovacoes'
    FROM public.condominios c JOIN public.gerentes g ON c.gerente_id = g.id
    WHERE c.id = NEW.condominio_id AND g.profile_id IS NOT NULL;

  -- 2) Aguardando SUPERVISOR -> notifica os supervisores
  ELSIF st LIKE '%aguardando supervisor%' OR st LIKE 'pendente_sup%' OR st LIKE '%supervisor%' OR st LIKE '%chefe%' THEN
    INSERT INTO public.notificacoes (user_id, tipo, titulo, mensagem, link)
    SELECT p.id, 'emissao_aprovacao',
           'Emissão aguardando aprovação',
           condo_nome || ' · ' || periodo || ' — pendente de aprovação.',
           '/aprovacoes'
    FROM public.profiles p
    WHERE p.role IN ('supervisora', 'supervisora_contabilidade', 'supervisor_gerentes');

  -- 3) Correção solicitada -> notifica o emissor (criador, senão master/departamento)
  ELSIF st = 'solicitar_correcao' THEN
    INSERT INTO public.notificacoes (user_id, tipo, titulo, mensagem, link)
    SELECT p.id, 'emissao_correcao',
           'Correção solicitada',
           condo_nome || ' · ' || periodo || ' — a emissão precisa de ajustes e reenvio.',
           '/central-emissoes'
    FROM public.profiles p
    WHERE (NEW.uploaded_by IS NOT NULL AND p.id = NEW.uploaded_by)
       OR (NEW.uploaded_by IS NULL AND p.role IN ('master', 'departamento'));

  -- 4) Aprovado / Registrado -> notifica o emissor
  ELSIF st = 'aprovado' OR st = 'registrado' THEN
    INSERT INTO public.notificacoes (user_id, tipo, titulo, mensagem, link)
    SELECT p.id,
           CASE WHEN st = 'registrado' THEN 'emissao_registrada' ELSE 'emissao_aprovada' END,
           CASE WHEN st = 'registrado' THEN 'Emissão registrada' ELSE 'Emissão aprovada' END,
           condo_nome || ' · ' || periodo || (CASE WHEN st = 'registrado' THEN ' — registro concluído.' ELSE ' — aprovada, pode prosseguir.' END),
           '/central-emissoes'
    FROM public.profiles p
    WHERE (NEW.uploaded_by IS NOT NULL AND p.id = NEW.uploaded_by)
       OR (NEW.uploaded_by IS NULL AND p.role IN ('master', 'departamento'));
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_notificar_emissao ON public.emissoes_pacotes;
CREATE TRIGGER trg_notificar_emissao
  AFTER INSERT OR UPDATE OF status ON public.emissoes_pacotes
  FOR EACH ROW EXECUTE FUNCTION public.notificar_emissao();

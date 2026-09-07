-- ============================================================================
-- 0121 — Usuário ativo ou inativo
-- ============================================================================
--
-- `gerentes` sabe quem está na operação desde a 0104. `profiles` não sabia — e
-- `profiles` é quem manda no ACESSO.
--
-- Hoje, tirar alguém do sistema tem dois caminhos e nenhum bom: apagar o
-- usuário (perde o histórico: quem aprovou o quê, quem lançou qual valor) ou
-- derrubar a sessão dele no painel do Supabase, o que dura até ele entrar de
-- novo. Não existia "esta pessoa não trabalha mais aqui".
--
-- Isso apareceu medindo latência, de lado: a API pergunta ao Supabase Auth se a
-- sessão vive, a cada requisição, e isso custa ~200 ms com o banco em Oregon.
-- Dava para conferir o token localmente e economizar os 200 ms — mas essa
-- pergunta era, sem querer, o ÚNICO corte de acesso que o sistema tinha. Com
-- esta coluna o corte passa a ser explícito, e some a razão de pagar 200 ms
-- para descobri-lo por acaso.
--
-- `ativo` começa TRUE para todos, pelo mesmo motivo da 0104: o contrário
-- trancaria as 21 pessoas na segunda-feira até alguém liberar uma por uma.
--
-- Mesmos nomes de coluna da 0104. Duas tabelas com a mesma ideia e nomes
-- diferentes é como se escreve o bug de olhar a coluna errada.
-- ============================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS ativo BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS inativado_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS inativado_motivo TEXT,
  -- ON DELETE SET NULL, e não o padrão: o sistema apaga usuários
  -- (`DELETE /usuarios/{id}`), e sem isto apagar quem um dia cortou o acesso de
  -- alguém passaria a esbarrar numa chave estrangeira, num lugar que ninguém
  -- suspeitaria de olhar.
  ADD COLUMN IF NOT EXISTS inativado_por UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.profiles.ativo IS
  'Tem acesso ao sistema. Inativo leva 401 em toda rota da API — o cadastro e o histórico ficam.';
COMMENT ON COLUMN public.profiles.inativado_em IS
  'Quando o acesso foi cortado. Preenchido pelo sistema.';
COMMENT ON COLUMN public.profiles.inativado_motivo IS
  'Por que foi cortado. Seis meses depois, "por que esta pessoa não entra mais?" é a pergunta que alguém vai fazer.';
COMMENT ON COLUMN public.profiles.inativado_por IS
  'Quem cortou. Tirar o acesso de alguém é ato que precisa de dono.';

CREATE INDEX IF NOT EXISTS idx_profiles_ativo ON public.profiles(ativo);

-- ============================================================================
-- A trava não pode viver só na API
-- ============================================================================
-- O navegador fala DIRETO com o Supabase em várias telas (emissoes_pacotes,
-- emissoes_arquivos, storage). Barrar só na API deixaria o inativo com a chave
-- anon na mão e o RLS achando que ele é um usuário como outro qualquer.
--
-- `SECURITY DEFINER` e `search_path` fixo: a função é chamada de dentro de
-- policies, e sem o schema fixo um `search_path` de sessão consegue apontar
-- `profiles` para outra tabela.

CREATE OR REPLACE FUNCTION public.usuario_ativo()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT p.ativo FROM public.profiles p WHERE p.id = auth.uid()),
    FALSE   -- sem perfil não é usuário conhecido; nega
  );
$$;

COMMENT ON FUNCTION public.usuario_ativo() IS
  'O usuário da requisição tem acesso? Para usar em policies de RLS junto do recorte de carteira.';

REVOKE ALL ON FUNCTION public.usuario_ativo() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.usuario_ativo() TO authenticated, service_role;

-- Nota deliberada: esta migration NÃO reescreve as policies existentes para
-- exigir `usuario_ativo()`. São dezenas, espalhadas por 0073–0119, e mexer em
-- todas de uma vez é a receita para derrubar a operação numa segunda-feira. A
-- função fica pronta e o corte vale imediatamente pela API, que é por onde
-- passa a escrita que importa. Ligar policy por policy é trabalho separado,
-- com teste, e está anotado como pendente.

-- ============================================================================
-- 0122 — As policies do bucket `emissoes`, que a migração de região deixou para trás
-- ============================================================================
--
-- SINTOMA: anexar arquivo na cobrança extra (e em qualquer outro upload)
-- respondia `new row violates row-level security policy`.
--
-- CAUSA: o dump de schema da CLI do Supabase EXCLUI o schema `storage`
-- (`--exclude-schema "...|storage|..."`). Ele é tratado como parte da
-- plataforma, e num projeto novo vem "de fábrica" — só que sem as policies que
-- este projeto tinha criado. Resultado da mudança para São Paulo em 07/09/2026:
--
--     projeto antigo (Oregon)    3 policies em storage.objects
--     projeto novo (São Paulo)   0
--
-- O upload sai do NAVEGADOR com a chave `authenticated`, então ele passa pelo
-- RLS. Sem policy de INSERT, o Postgres recusa — e a mensagem que chega na tela
-- é exatamente a do print do usuário.
--
-- O download continuou funcionando o tempo todo, e por isso ninguém notou
-- antes: ele usa URL assinada gerada pela API com a chave de serviço, que
-- ignora RLS. Só a ESCRITA vem do navegador.
--
-- Estas três são cópia fiel do que existia no projeto antigo, extraídas de
-- `pg_policies` de lá. A única mudança é `public.profiles` no lugar de
-- `profiles`: dentro de uma policy, nome sem schema depende do `search_path` de
-- quem executa — o mesmo cuidado da 0121.
-- ============================================================================

-- Quem está logado pode ENVIAR arquivo, e só para o bucket `emissoes`.
DROP POLICY IF EXISTS "INSERT para usuários autenticados" ON storage.objects;
CREATE POLICY "INSERT para usuários autenticados"
  ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'emissoes'::text);

-- Trocar ou apagar: só quem enviou, ou o master.
DROP POLICY IF EXISTS "UPDATE e DELETE apenas para uploader ou master" ON storage.objects;
CREATE POLICY "UPDATE e DELETE apenas para uploader ou master"
  ON storage.objects AS PERMISSIVE FOR UPDATE TO authenticated
  USING (
    bucket_id = 'emissoes'::text
    AND (
      auth.uid() = owner
      OR EXISTS (SELECT 1 FROM public.profiles p
                  WHERE p.id = auth.uid() AND p.role = 'master'::user_role)
    )
  );

DROP POLICY IF EXISTS "DELETE apenas para uploader ou master" ON storage.objects;
CREATE POLICY "DELETE apenas para uploader ou master"
  ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated
  USING (
    bucket_id = 'emissoes'::text
    AND (
      auth.uid() = owner
      OR EXISTS (SELECT 1 FROM public.profiles p
                  WHERE p.id = auth.uid() AND p.role = 'master'::user_role)
    )
  );

-- Não há policy de SELECT, e é de propósito: a leitura de arquivo passa pela
-- API, que assina uma URL com a chave de serviço. Abrir SELECT aqui daria ao
-- navegador uma segunda porta para o bucket, sem o recorte de carteira que a
-- API aplica.

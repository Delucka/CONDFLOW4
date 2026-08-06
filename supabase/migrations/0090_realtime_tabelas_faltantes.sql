-- ============================================================
-- 0090 — Metade do "tempo real" nunca esteve ligada
-- ============================================================
-- O front assina 9 tabelas via `supabase.channel(...).on('postgres_changes')`.
-- Só 6 estavam na publicação `supabase_realtime`. As outras 4 assinavam o vazio:
-- a inscrição é aceita, nenhum evento chega, nenhum erro aparece.
--
-- É a causa do "só atualiza com F5": criar um pacote, liberar um mês ou anexar
-- um arquivo não avisava ninguém. A tela seguia mostrando o que carregou na
-- montagem.
--
--   assinadas pelo front        publicadas antes desta migration
--   ------------------------    --------------------------------
--   emissoes_pacotes       7×   sim
--   edicoes_mensais        3×   NAO
--   processos              2×   NAO
--   alteracoes_rateio      2×   sim
--   pipeline_config        1×   NAO
--   notificacoes           1×   sim
--   emissoes_preparacao    1×   sim
--   emissoes_ocorrencias   1×   sim
--   emissoes_arquivos      1×   NAO
--
-- ⚠️ `postgres_changes` do Supabase respeita RLS: cada assinante só recebe as
--    linhas que já poderia LER. Publicar não abre dado novo para ninguém.
--    Ainda assim, só entram aqui as 4 que o front realmente assina — publicar
--    tabela sem assinante é WAL à toa.
--
-- ⚠️ ROLLBACK:
--   ALTER PUBLICATION supabase_realtime DROP TABLE public.edicoes_mensais;
--   ALTER PUBLICATION supabase_realtime DROP TABLE public.processos;
--   ALTER PUBLICATION supabase_realtime DROP TABLE public.emissoes_arquivos;
--   ALTER PUBLICATION supabase_realtime DROP TABLE public.pipeline_config;
-- ============================================================

-- `ADD TABLE` estoura se a tabela já estiver publicada, e a lista acima foi
-- lida das migrations — que já mentiram antes. O DO confere na fonte real
-- (pg_publication_tables) e pula o que já está lá.
DO $realtime$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['edicoes_mensais', 'processos', 'emissoes_arquivos', 'pipeline_config']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) AND EXISTS (
      SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
      RAISE NOTICE 'realtime ligado: %', t;
    ELSE
      RAISE NOTICE 'realtime ja estava (ou tabela nao existe): %', t;
    END IF;
  END LOOP;
END $realtime$;

-- ── Conferência ──
-- As 9 que o front assina devem aparecer aqui:
--   SELECT tablename FROM pg_publication_tables
--    WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
--    ORDER BY tablename;

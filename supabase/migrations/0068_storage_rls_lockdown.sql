-- ==========================================
-- MIGRATION 0068: Tranca a LEITURA do storage (só o backend lê)
-- Remove as policies que deixavam "qualquer autenticado ler qualquer arquivo".
-- Depois disto, o client (chave anon) NÃO consegue mais gerar acesso a arquivo —
-- só pelo nosso backend (/api/arquivo, service-role, com checagem POR ARQUIVO).
-- Upload (INSERT), atualização e exclusão continuam funcionando.
--
-- ⚠️ Rode SÓ depois de confirmar (no site já deployado) que os arquivos ainda
--    abrem normalmente. Se algum arquivo parar de abrir, é um caminho não coberto
--    pelo backend — me avise antes/depois e eu ajusto o lookup.
-- ==========================================

DROP POLICY IF EXISTS "Autenticados leem bucket emissoes" ON storage.objects;
DROP POLICY IF EXISTS "SELECT para usuários autenticados" ON storage.objects;

-- Conferência (deve sobrar INSERT/UPDATE/DELETE para authenticated, e NENHUM SELECT):
-- SELECT policyname, cmd FROM pg_policies WHERE schemaname='storage' AND tablename='objects';

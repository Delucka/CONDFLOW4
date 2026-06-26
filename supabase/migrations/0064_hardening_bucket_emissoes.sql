-- ==========================================
-- MIGRATION 0064: Blindagem do bucket de arquivos (anti-bombardeio / abuso)
-- Aplicado pelo Supabase no SERVIDOR — vale mesmo com token válido roubado.
--   1) bucket PRIVADO (acesso só por URL assinada, nunca pública)
--   2) limite de tamanho por arquivo (impede upload gigante p/ inchar/derrubar)
-- ==========================================

UPDATE storage.buckets
SET public = false,
    file_size_limit = 26214400   -- 25 MB por arquivo
WHERE id = 'emissoes';

-- (Opcional, mais restritivo) aceitar só PDF/imagem.
-- Se algum upload legítimo passar a falhar, basta NÃO rodar este bloco (o limite de
-- tamanho acima já barra o "bombardeio").
UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
      'application/pdf',
      'image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'image/heic'
    ]
WHERE id = 'emissoes';

-- Conferência (rode pra ver como ficou):
-- SELECT id, public, file_size_limit, allowed_mime_types FROM storage.buckets WHERE id = 'emissoes';

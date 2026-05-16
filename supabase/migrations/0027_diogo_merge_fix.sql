-- ==========================================
-- MIGRATION: Corrige o merge do Diogo
-- Ordem certa: move condos → apaga ghost → só depois atualiza real
-- ==========================================

DO $$
DECLARE
  diogo_profile_id        UUID;
  diogo_real_gerente_id   UUID;
  diogo_ghost_gerente_id  UUID;
BEGIN
  -- Acha profile do Diogo
  SELECT p.id INTO diogo_profile_id
  FROM public.profiles p
  WHERE p.full_name ILIKE '%diogo%'
  ORDER BY p.full_name
  LIMIT 1;

  -- Acha ghost (codigo 0024, sem profile)
  SELECT id INTO diogo_ghost_gerente_id
  FROM public.gerentes
  WHERE codigo_externo = '0024' AND profile_id IS NULL
  LIMIT 1;

  IF diogo_profile_id IS NOT NULL THEN
    -- Acha gerente REAL do Diogo (linkado ao profile)
    SELECT id INTO diogo_real_gerente_id
    FROM public.gerentes
    WHERE profile_id = diogo_profile_id
    LIMIT 1;

    IF diogo_real_gerente_id IS NOT NULL AND diogo_ghost_gerente_id IS NOT NULL
       AND diogo_real_gerente_id <> diogo_ghost_gerente_id THEN

      -- 1) Move condos do ghost pro real
      UPDATE public.condominios
      SET gerente_id = diogo_real_gerente_id
      WHERE gerente_id = diogo_ghost_gerente_id;

      -- 2) APAGA ghost PRIMEIRO (libera o codigo_externo)
      DELETE FROM public.gerentes WHERE id = diogo_ghost_gerente_id;

      -- 3) Agora pode atualizar o real com codigo_externo=0024
      UPDATE public.gerentes
      SET nome = 'Diogo', codigo_externo = '0024'
      WHERE id = diogo_real_gerente_id;

      -- 4) Padroniza nome no profile
      UPDATE public.profiles SET full_name = 'Diogo' WHERE id = diogo_profile_id;

      RAISE NOTICE 'Diogo: merge realizado (ghost → real, condos movidos)';
    ELSIF diogo_ghost_gerente_id IS NOT NULL AND diogo_real_gerente_id IS NULL THEN
      -- Só ghost existe: vincula ao profile
      UPDATE public.gerentes
      SET profile_id = diogo_profile_id, nome = 'Diogo'
      WHERE id = diogo_ghost_gerente_id;
      UPDATE public.profiles SET full_name = 'Diogo' WHERE id = diogo_profile_id;
      RAISE NOTICE 'Diogo: vinculou profile ao ghost';
    ELSE
      RAISE NOTICE 'Diogo: nada a fazer (ja consolidado)';
    END IF;
  ELSE
    RAISE NOTICE 'Diogo: profile nao encontrado';
  END IF;
END $$;


-- Relatorio final
SELECT
  g.codigo_externo,
  g.nome,
  CASE WHEN g.profile_id IS NULL THEN '🔓 Sem login' ELSE '✅ Com login' END AS status,
  (SELECT COUNT(*) FROM public.condominios WHERE gerente_id = g.id) AS condos
FROM public.gerentes g
ORDER BY g.codigo_externo;

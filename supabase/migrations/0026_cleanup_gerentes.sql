-- ==========================================
-- MIGRATION: Limpeza pré-import de gerentes
-- 1) Remove ghost Fernando (codigo 0002) — ele é supervisor, não gerente
-- 2) Atualiza nomes dos demais ghosts pra versão limpa
-- 3) Merge do Diogo (gerente real + ghost 0024)
-- ==========================================

-- ────────────────────────────────────────────────
-- 1) Remove ghost Fernando + libera seus 2 condos
-- ────────────────────────────────────────────────
UPDATE public.condominios
SET gerente_id = NULL
WHERE gerente_id IN (SELECT id FROM public.gerentes WHERE codigo_externo = '0002');

DELETE FROM public.gerentes WHERE codigo_externo = '0002';


-- ────────────────────────────────────────────────
-- 2) Padroniza nomes (versão limpa, sem "SUP. FERNANDO")
-- ────────────────────────────────────────────────
UPDATE public.gerentes SET nome = 'Abdon Gabriel de Souza Filho'      WHERE codigo_externo = '0001';
UPDATE public.gerentes SET nome = 'Eduardo Pessolato'                 WHERE codigo_externo = '0003';
UPDATE public.gerentes SET nome = 'Juliana F. Nakano'                 WHERE codigo_externo = '0004';
UPDATE public.gerentes SET nome = 'Mauro Dametto'                     WHERE codigo_externo = '0005';
UPDATE public.gerentes SET nome = 'Suellen Teixeira'                  WHERE codigo_externo = '0007';
UPDATE public.gerentes SET nome = 'Mauro P. Junior'                   WHERE codigo_externo = '0008';
UPDATE public.gerentes SET nome = 'Rodrigo C. Fernandes'              WHERE codigo_externo = '0009';
UPDATE public.gerentes SET nome = 'Claudia R. Souza'                  WHERE codigo_externo = '0010';
UPDATE public.gerentes SET nome = 'Lectorium'                         WHERE codigo_externo = '0011';
UPDATE public.gerentes SET nome = 'Natalia Martins'                   WHERE codigo_externo = '0013';
UPDATE public.gerentes SET nome = 'Marlei Leite de Queiroz Santos'    WHERE codigo_externo = '0014';
UPDATE public.gerentes SET nome = 'Patricia F. Marinho'               WHERE codigo_externo = '0015';
UPDATE public.gerentes SET nome = 'Aline Bulara'                      WHERE codigo_externo = '0016';
UPDATE public.gerentes SET nome = 'Diogo'                             WHERE codigo_externo = '0024';


-- ────────────────────────────────────────────────
-- 3) Merge do Diogo: junta real + ghost numa entrada só
-- ────────────────────────────────────────────────
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

  -- Acha ghost (codigo 0024)
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
      -- Move condos do ghost pro real
      UPDATE public.condominios
      SET gerente_id = diogo_real_gerente_id
      WHERE gerente_id = diogo_ghost_gerente_id;

      -- Atualiza nome + codigo_externo do real
      UPDATE public.gerentes
      SET nome = 'Diogo', codigo_externo = '0024'
      WHERE id = diogo_real_gerente_id;

      -- Apaga ghost duplicado
      DELETE FROM public.gerentes WHERE id = diogo_ghost_gerente_id;

      -- Padroniza nome no profile
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
      RAISE NOTICE 'Diogo: nada a fazer (já consolidado ou não tem ghost)';
    END IF;
  ELSE
    RAISE NOTICE 'Diogo: profile não encontrado';
  END IF;
END $$;


-- ────────────────────────────────────────────────
-- 4) RELATÓRIO final
-- ────────────────────────────────────────────────
SELECT
  g.codigo_externo,
  g.nome,
  CASE WHEN g.profile_id IS NULL THEN '🔓 Sem login' ELSE '✅ Com login' END AS status,
  (SELECT COUNT(*) FROM public.condominios WHERE gerente_id = g.id) AS condos
FROM public.gerentes g
ORDER BY g.codigo_externo;

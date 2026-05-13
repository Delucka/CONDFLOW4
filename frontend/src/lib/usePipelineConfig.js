'use client';
import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/utils/supabase/client';

export function usePipelineConfig(ano) {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  const refetch = useCallback(async () => {
    if (!ano) return;
    setLoading(true);
    const { data } = await supabase
      .from('pipeline_config')
      .select('*')
      .eq('ano', ano)
      .maybeSingle();
    setConfig(data || null);
    setLoading(false);
  }, [ano]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { refetch(); }, [refetch]);

  const update = useCallback(async (patch) => {
    const { data, error } = await supabase
      .from('pipeline_config')
      .upsert(
        { ano, ...patch, atualizado_em: new Date().toISOString() },
        { onConflict: 'ano' }
      )
      .select()
      .single();
    if (!error) setConfig(data);
    return { data, error };
  }, [ano]); // eslint-disable-line react-hooks/exhaustive-deps

  return { config, loading, update, refetch };
}

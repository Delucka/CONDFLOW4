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

  // A primeira busca NAO passa por `refetch`, de proposito: ele comeca com
  // `setLoading(true)` sincrono, e `loading` ja nasce true — era um render
  // extra para chegar ao mesmo lugar. `refetch` continua existindo para as
  // recargas manuais, onde o setLoading tem funcao.
  useEffect(() => {
    if (!ano) return undefined;
    let vivo = true;
    (async () => {
      const { data } = await supabase
        .from('pipeline_config').select('*').eq('ano', ano).maybeSingle();
      if (!vivo) return;                 // trocou de ano no meio da busca
      setConfig(data || null);
      setLoading(false);
    })();
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ano]);

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

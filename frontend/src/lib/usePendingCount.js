'use client';
import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/utils/supabase/client';
import { useAuth } from '@/lib/auth';

/**
 * Hook que conta quantos pacotes de emissão pendem da ação do usuário logado,
 * baseado no role. Usado pra mostrar badge na sidebar e toggle no Painel.
 *
 * Mapeamento role → status que pendem:
 *   - master:                       todos pendente_* + aprovado
 *   - supervisor_gerentes:          status contém 'sup. gerentes' ou 'chefe'
 *   - supervisora_contabilidade:    status contém 'supervisor' (mas não 'gerentes')
 *   - supervisora:                  idem supervisora_contabilidade
 *   - gerente:                      status contém 'gerente' (não 'sup') OR 'pendente' puro
 *                                   E pacote tem condominio do gerente
 *   - departamento (emissor):       status = aprovado (prontos pra registrar)
 *   - outros:                       0
 */
export function usePendingCount() {
  const { profile, user } = useAuth();
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchCount = useCallback(async () => {
    if (!profile?.role || !user?.id) {
      setCount(0); setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const supabase = createClient();
      const role = profile.role;

      let query = supabase
        .from('emissoes_pacotes')
        .select('id, status, condominio_id', { count: 'exact', head: false });

      // Pré-filtro: pacotes "vivos" (não rascunho, não registrado, não expedido)
      query = query
        .not('status', 'eq', 'rascunho')
        .not('status', 'eq', 'expedida')
        .or('lacrada.is.null,lacrada.eq.false');

      const { data, error } = await query;
      if (error) throw error;

      const all = data || [];

      // Filtra pelo role
      let filtered = [];
      if (role === 'master') {
        filtered = all.filter(p => {
          const s = (p.status || '').toLowerCase();
          return s !== 'registrado' && s !== 'expedida';
        });
      } else if (role === 'supervisor_gerentes') {
        filtered = all.filter(p => {
          const s = (p.status || '').toLowerCase();
          return s.includes('sup. gerentes') || s.includes('chefe');
        });
      } else if (role === 'supervisora_contabilidade' || role === 'supervisora') {
        filtered = all.filter(p => {
          const s = (p.status || '').toLowerCase();
          return s.includes('supervisor') && !s.includes('sup. gerentes') && !s.includes('chefe');
        });
      } else if (role === 'gerente') {
        // Acha condominio_ids do gerente
        const { data: gerData } = await supabase
          .from('gerentes').select('id').eq('profile_id', user.id).maybeSingle();
        if (!gerData) { filtered = []; }
        else {
          const { data: condosData } = await supabase
            .from('condominios').select('id').eq('gerente_id', gerData.id);
          const myCondos = new Set((condosData || []).map(c => c.id));
          filtered = all.filter(p => {
            const s = (p.status || '').toLowerCase();
            const isGerentePending = s === 'pendente' || (s.includes('gerente') && !s.includes('sup'));
            return isGerentePending && myCondos.has(p.condominio_id);
          });
        }
      } else if (role === 'departamento') {
        filtered = all.filter(p => (p.status || '').toLowerCase() === 'aprovado');
      } else {
        filtered = [];
      }

      setCount(filtered.length);
    } catch (e) {
      console.error('[usePendingCount] erro:', e);
      setCount(0);
    } finally {
      setLoading(false);
    }
  }, [profile?.role, user?.id]);

  useEffect(() => { fetchCount(); }, [fetchCount]);

  // Realtime: atualiza badge quando algum pacote muda
  useEffect(() => {
    if (!profile?.role) return;
    const supabase = createClient();
    const ch = supabase.channel(`pending_count_${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'emissoes_pacotes' }, fetchCount)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [profile?.role, fetchCount]);

  return { count, loading, refetch: fetchCount };
}

/**
 * Helper: verifica se um status de pacote pende da ação do role atual.
 * Usado no toggle "Só minhas pendências" do Painel de Gestão.
 */
export function isPendingForRole(status, role) {
  const s = (status || '').toLowerCase();
  if (!s || !role) return false;
  if (role === 'master')                                return s !== 'registrado' && s !== 'expedida' && s !== 'rascunho';
  if (role === 'supervisor_gerentes')                   return s.includes('sup. gerentes') || s.includes('chefe');
  if (role === 'supervisora_contabilidade' || role === 'supervisora')
                                                         return s.includes('supervisor') && !s.includes('sup. gerentes') && !s.includes('chefe');
  if (role === 'gerente')                               return s === 'pendente' || (s.includes('gerente') && !s.includes('sup'));
  if (role === 'departamento')                          return s === 'aprovado';
  return false;
}

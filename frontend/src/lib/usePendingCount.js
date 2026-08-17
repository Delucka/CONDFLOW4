'use client';
import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/utils/supabase/client';
import { useRealtime } from '@/lib/realtime';
import { statusEstaEm, COM_GERENTE, COM_SUP_GERENTES, COM_SUP_CONTABILIDADE } from '@/lib/statusEmissao';
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
        filtered = all.filter(p => statusEstaEm(p.status, COM_SUP_GERENTES));
      } else if (role === 'supervisora_contabilidade' || role === 'supervisora') {
        filtered = all.filter(p => statusEstaEm(p.status, COM_SUP_CONTABILIDADE));
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
            return statusEstaEm(p.status, COM_GERENTE) && myCondos.has(p.condominio_id);
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

  // Realtime: atualiza badge quando algum pacote muda.
  // Debounce: uma rajada de mudanças (ex.: várias aprovações seguidas) vira UM
  // refetch em vez de N. Não altera O QUE é contado — só evita a tempestade de
  // requisições sob carga (esse hook roda p/ todo usuário logado).
  useEffect(() => {
    if (!profile?.role) return;
    const supabase = createClient();
    let t = null;
    const agendarRefetch = () => { clearTimeout(t); t = setTimeout(fetchCount, 1200); };
    return () => { clearTimeout(t); };
  }, [profile?.role, fetchCount]);

  useRealtime(['emissoes_pacotes'], fetchCount);

  return { count, loading, refetch: fetchCount };
}

/**
 * Verifica se um status de pacote pende da ação do role atual.
 * Usado no toggle "Só minhas pendências" do Painel de Gestão.
 *
 * Compara por LISTA (lib/statusEmissao.js), nunca por pedaço de texto. Antes era
 * `includes('sup. gerentes')`, com ponto e espaço, enquanto a grafia real é
 * `pendente_sup_gerentes`, com underline: o sino dos dois supervisores ficou
 * marcando ZERO desde que a grafia nova entrou. Eles simplesmente não eram
 * avisados de nada.
 */
export function isPendingForRole(status, role) {
  const s = (status || '').toLowerCase();
  if (!s || !role) return false;
  if (role === 'master')                                return s !== 'registrado' && s !== 'expedida' && s !== 'rascunho';
  if (role === 'supervisor_gerentes')                   return statusEstaEm(status, COM_SUP_GERENTES);
  if (role === 'supervisora_contabilidade' || role === 'supervisora')
                                                         return statusEstaEm(status, COM_SUP_CONTABILIDADE);
  if (role === 'gerente')                               return statusEstaEm(status, COM_GERENTE);
  if (role === 'departamento')                          return s === 'aprovado';
  return false;
}

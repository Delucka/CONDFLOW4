'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@/utils/supabase/client';
import { useAuth } from '@/lib/auth';

/**
 * A carteira de quem está olhando — em um lugar só.
 *
 * O RLS de `condominios`, `rateios` e `emissoes_*` é `USING (true)`: o banco
 * entrega tudo a qualquer pessoa autenticada. Quem recorta por carteira é a
 * aplicação, e isso já estava escrito de novo em cada tela que precisou —
 * dashboard, fila de ocorrências, sino, relatório. Escrito em vários lugares,
 * um deles esquece: as páginas de `/condominio/[id]` nunca recortaram.
 *
 * Enquanto o RLS não for religado, este módulo é o recorte. Ele não é barreira
 * de segurança de verdade — quem chamar o Supabase direto com a anon key passa
 * por cima dele. É o que impede o acesso acidental e deixa a intenção explícita
 * em um lugar só, pronta para virar policy.
 */

/**
 * `gerentes.id` da carteira de quem está olhando.
 *   • gerente    → a própria
 *   • assistente → a do gerente a que está vinculado (profiles.gerente_id, 0057)
 *   • demais     → null, que aqui significa "vê tudo"
 */
export async function carteiraGerenteId(supabase, profile) {
  const role = profile?.role;
  if (role === 'gerente') {
    const { data } = await supabase
      .from('gerentes').select('id').eq('profile_id', profile.id).maybeSingle();
    return data?.id || null;
  }
  if (role === 'assistente') {
    const pid = profile?.gerente_profile_id;
    if (!pid) return null;
    const { data } = await supabase
      .from('gerentes').select('id').eq('profile_id', pid).maybeSingle();
    return data?.id || null;
  }
  return null;
}

/** Ids dos condomínios da carteira, ou `null` quando não há recorte. */
export async function condosDaCarteira(supabase, profile) {
  const gId = await carteiraGerenteId(supabase, profile);
  if (!gId) return null;
  const { data } = await supabase.from('condominios').select('id').eq('gerente_id', gId);
  return (data || []).map(c => c.id);
}

/** Quem tem carteira: só gerente e assistente. */
export function temRecorteDeCarteira(role) {
  return role === 'gerente' || role === 'assistente';
}

/**
 * Este condomínio é da carteira de quem está olhando?
 *
 * As telas de `/condominio/[id]` são abertas pela lista — que já vem recortada —
 * mas o id vai na URL, e URL se digita, se guarda nos favoritos e se manda por
 * mensagem. Sem esta checagem, um gerente que troque o id na barra de endereços
 * abre (e edita) a planilha de outro.
 *
 * `permitido` começa `false` e só abre depois da resposta: o contrário mostraria
 * a planilha alheia por uma fração de segundo antes de fechar a porta.
 */
export function useCondoNaCarteira(condoId) {
  const supabase = createClient();
  const { profile } = useAuth();
  const [estado, setEstado] = useState({ carregando: true, permitido: false });

  useEffect(() => {
    let cancelado = false;
    (async () => {
      const role = profile?.role;
      if (!role) { setEstado({ carregando: true, permitido: false }); return; }
      if (!temRecorteDeCarteira(role)) {
        setEstado({ carregando: false, permitido: true });
        return;
      }
      if (!condoId) { setEstado({ carregando: false, permitido: false }); return; }

      const gId = await carteiraGerenteId(supabase, profile);
      if (cancelado) return;
      if (!gId) { setEstado({ carregando: false, permitido: false }); return; }

      const { data } = await supabase
        .from('condominios').select('id').eq('id', condoId).eq('gerente_id', gId).maybeSingle();
      if (cancelado) return;
      setEstado({ carregando: false, permitido: !!data });
    })();
    return () => { cancelado = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [condoId, profile?.id, profile?.role, profile?.gerente_profile_id]);

  return estado;
}

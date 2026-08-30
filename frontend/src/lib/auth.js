'use client';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { createClient } from '@/utils/supabase/client';
import { limparCachePersistido } from '@/components/SWRProvider';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [supabase] = useState(() => createClient());

  // "Ver como": o master olha o app pelos olhos de outro papel.
  //
  // Existe porque a alternativa é pior. Para ver a tela da expedição alguém
  // precisava VIRAR expedição — e criar esse login por cima do e-mail do master
  // trocou o papel do único master do sistema, que então não podia mais
  // desfazer nada. Isto aqui é reversível e não escreve em cadastro nenhum.
  //
  // É PRÉVIA DE TELA, não troca de permissão: o servidor continua vendo um
  // master, então uma escrita feita nesse modo passa. Serve para conferir o que
  // a pessoa vê, não para testar o que ela pode.
  //
  // sessionStorage, não localStorage: fechou a aba, acabou. Um master que
  // esquecesse o modo ligado abriria o app amanhã achando que perdeu acesso —
  // exatamente o susto que este recurso veio evitar.
  const [verComo, setVerComoEstado] = useState(null);
  useEffect(() => {
    try {
      const salvo = sessionStorage.getItem('condoflow_ver_como');
      if (salvo) setVerComoEstado(salvo);
    } catch { /* navegador sem storage: segue como master */ }
  }, []);

  function setVerComo(papel) {
    setVerComoEstado(papel || null);
    try {
      if (papel) sessionStorage.setItem('condoflow_ver_como', papel);
      else sessionStorage.removeItem('condoflow_ver_como');
    } catch { /* só perde a memória entre recarregamentos */ }
  }

  // De quem é o perfil que já está carregado ou a caminho.
  //
  // O perfil era buscado no `getSession()` E de novo a cada evento de
  // autenticação — e o Supabase dispara vários na abertura da página
  // (INITIAL_SESSION, SIGNED_IN, e TOKEN_REFRESHED quando a sessão é renovada).
  // Eram três buscas do mesmo perfil, cada uma puxando `gerentes` atrás: seis
  // idas ao banco para um dado que não muda dentro da sessão.
  //
  // No plano Free do Supabase cada ida custa 250-500 ms, medido — então isto
  // sozinho tirava mais de um segundo de toda abertura de página.
  const perfilDeRef = useRef(null);

  async function fetchProfile(uid, { forcar = false } = {}) {
    if (!uid) return;
    if (!forcar && perfilDeRef.current === uid) return;
    perfilDeRef.current = uid;
    try {
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', uid)
        .single();
      
      if (error) throw error;
      
      let gerenteId = null;
      if (profile.role === 'gerente') {
        const { data: gerente } = await supabase
          .from('gerentes')
          .select('id')
          .eq('profile_id', uid)
          .single();
        if (gerente) gerenteId = gerente.id;
      }
      
      // CUIDADO com os dois sentidos de `gerente_id` (Armadilha 2 do ESQUEMA-BANCO):
      //   • para o GERENTE, aqui ele vira `gerentes.id` — é o que as telas esperam;
      //   • na LINHA de um assistente, a coluna guarda o id do PROFILE do gerente.
      // A linha abaixo sobrescrevia o segundo caso com null, apagando o vínculo do
      // assistente antes que qualquer tela pudesse usá-lo. Preservado num campo
      // próprio, para não mudar o significado de `gerente_id` para quem já o lê.
      setProfile({
        ...profile,
        gerente_id: gerenteId,
        gerente_profile_id: profile.role === 'assistente' ? (profile.gerente_id || null) : null,
      });
    } catch (e) {
      // Libera a trava: sem isto, um erro de rede na primeira tentativa
      // deixaria a sessão para sempre sem perfil, porque nenhuma busca
      // seguinte passaria pela guarda acima.
      perfilDeRef.current = null;
      console.error('Error fetching profile:', e);
    }
  }

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return;
      if (session?.user) {
        setUser(session.user);
        fetchProfile(session.user.id);
      }
      setLoading(false);
    }).catch(err => {
      console.error('[Auth] getSession fatal error:', err);
      if (mounted) setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        if (!mounted) return;
        if (session?.user) {
          setUser(session.user);
          fetchProfile(session.user.id);
        } else {
          setUser(null);
          setProfile(null);
          perfilDeRef.current = null;
        }
        setLoading(false);
      }
    );

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  async function signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  }

  async function signOut() {
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
    perfilDeRef.current = null;
    // O cache do SWR sobrevive ao fechar a aba para a tela abrir preenchida.
    // No logout ele tem de ir junto: sao os dados de quem estava logado, e a
    // proxima pessoa a usar a maquina abriria o app com o painel do anterior.
    limparCachePersistido();
  }

  async function sendPasswordReset(email) {
    // Usa o NOSSO backend (e o nosso Gmail), não o e-mail do Supabase (que não chega sem SMTP).
    const redirect_to = `${window.location.origin}/reset-password`;
    const res = await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, redirect_to }),
    });
    if (!res.ok) {
      let msg = 'Não foi possível enviar o e-mail.';
      try { const j = await res.json(); msg = j.detail || msg; } catch {}
      throw new Error(msg);
    }
  }

  async function refreshProfile() {
    if (user?.id) await fetchProfile(user.id);
  }

  // Só o master finge ser outro — e só para menos. Se `verComo` chegasse de
  // qualquer outro papel, seria escalada de privilégio a um `setItem` de
  // distância; por isso o papel real é a origem da regra, não o guardado.
  const papelReal = profile?.role || null;
  const papelVisto = papelReal === 'master' && verComo ? verComo : papelReal;
  const profileVisto = profile ? { ...profile, role: papelVisto } : profile;

  // Merge profile data into user so user.role returns the app role ('master', 'gerente', etc.)
  const mergedUser = user && profile
    ? { ...user, role: papelVisto, full_name: profile.full_name, profile_id: profile.id, must_change_password: !!profile.must_change_password }
    : user;

  return (
    <AuthContext.Provider value={{
      user: mergedUser, profile: profileVisto, loading, signIn, signOut, sendPasswordReset, refreshProfile,
      papelReal, verComo: papelReal === 'master' ? verComo : null, setVerComo,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

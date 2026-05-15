'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import { createClient } from '@/utils/supabase/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [supabase] = useState(() => createClient());

  async function fetchProfile(uid) {
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
      
      setProfile({ ...profile, gerente_id: gerenteId });
    } catch (e) {
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
  }

  async function sendPasswordReset(email) {
    const redirectTo = `${window.location.origin}/reset-password`;
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) throw error;
  }

  async function refreshProfile() {
    if (user?.id) await fetchProfile(user.id);
  }

  // Merge profile data into user so user.role returns the app role ('master', 'gerente', etc.)
  const mergedUser = user && profile
    ? { ...user, role: profile.role, full_name: profile.full_name, profile_id: profile.id, must_change_password: !!profile.must_change_password }
    : user;

  return (
    <AuthContext.Provider value={{ user: mergedUser, profile, loading, signIn, signOut, sendPasswordReset, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

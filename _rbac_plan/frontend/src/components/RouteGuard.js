'use client';
import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { canAccessPath } from '@/lib/roles';
import { useToast } from '@/components/Toast';
import { ShieldAlert, Loader2 } from 'lucide-react';

/**
 * RouteGuard — envolve o conteúdo de uma rota e bloqueia acesso
 * se o role do usuário não tiver permissão.
 *
 * Uso (em um layout.js ou page.js):
 *   <RouteGuard>{children}</RouteGuard>
 *
 * Para forçar roles específicos (quando o path base não cobre o caso):
 *   <RouteGuard allowedRoles={['master', 'gerente']}>{children}</RouteGuard>
 */
export default function RouteGuard({ children, allowedRoles = null }) {
  const { profile, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const { addToast } = useToast();

  useEffect(() => {
    if (loading) return;

    // Sem perfil = manda pra login
    if (!profile) {
      router.replace('/login');
      return;
    }

    // Determina se o usuário pode acessar esta rota
    const allowed = allowedRoles
      ? allowedRoles.includes(profile.role)
      : canAccessPath(profile.role, pathname);

    if (!allowed) {
      addToast?.('Você não tem permissão para acessar esta página.', 'error');
      router.replace('/dashboard');
    }
  }, [profile, loading, pathname, router, allowedRoles, addToast]);

  if (loading || !profile) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
      </div>
    );
  }

  const allowed = allowedRoles
    ? allowedRoles.includes(profile.role)
    : canAccessPath(profile.role, pathname);

  if (!allowed) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <ShieldAlert className="w-12 h-12 text-red-400 mx-auto mb-3" />
          <p className="text-red-400 font-bold">Acesso restrito</p>
          <p className="text-slate-500 text-sm mt-1">Redirecionando...</p>
        </div>
      </div>
    );
  }

  return children;
}

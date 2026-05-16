'use client';
import RouteGuard from '@/components/RouteGuard';

export default function Layout({ children }) {
  // Não passa allowedRoles — usa canAccessPath que tem master-bypass automático
  return <RouteGuard>{children}</RouteGuard>;
}

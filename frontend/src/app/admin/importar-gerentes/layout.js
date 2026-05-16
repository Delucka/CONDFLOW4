'use client';
import RouteGuard from '@/components/RouteGuard';

export default function Layout({ children }) {
  return <RouteGuard>{children}</RouteGuard>;
}

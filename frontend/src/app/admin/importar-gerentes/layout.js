'use client';
// Sem RouteGuard — a página faz a checagem inline. Isso evita qualquer
// redirect inesperado que estava acontecendo.
export default function Layout({ children }) {
  return children;
}

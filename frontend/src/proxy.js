import { updateSession } from './utils/supabase/middleware'

export async function proxy(request) {
  return await updateSession(request)
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - tools/ (ferramentas estáticas em /public/tools — ex.: o Gerador de Rateio
     *   do Correio, embutido via <iframe>. Sem esta exclusão o middleware roda no
     *   pedido do iframe e o redireciona pra '/', quebrando o embed. O acesso à
     *   página /correios já é protegido pelo RouteGuard; o .html é só um utilitário
     *   client-side, sem dado sensível.)
     * Feel free to modify this pattern to include more paths.
     */
    '/((?!_next/static|_next/image|favicon.ico|api/|tools/|manifest.webmanifest|sw.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|webmanifest)$).*)',
  ],
}

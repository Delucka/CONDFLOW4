import RouteGuard from '@/components/RouteGuard';

/**
 * A guarda existia no mapa (`ROUTE_ACCESS`) mas nenhum componente a aplicava
 * aqui — por isso a expedição, que não tem acesso a esta página, abria o painel
 * inteiro e ficava esperando dados que o banco nunca ia devolver a ela.
 *
 * Layout, e não invólucro dentro do page.js, para ficar igual a /aprovacoes,
 * /carteiras, /central-emissoes e /correios.
 */
export default function DashboardLayout({ children }) {
  return <RouteGuard>{children}</RouteGuard>;
}

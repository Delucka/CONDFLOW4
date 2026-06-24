import { createBrowserClient } from '@supabase/ssr'

// Singleton do client do navegador.
// Antes, cada `createClient()` (chamado no corpo de cada componente, a cada render)
// devolvia uma instância NOVA. Como vários hooks colocam `supabase` na lista de
// dependências de useEffect/useCallback, isso recriava canais realtime, listeners
// de auth e intervals a cada render — vazando memória e travando a navegação.
// Agora a referência é estável no browser (1 instância por aba).
let browserClient = null

function dummyClient() {
  console.warn('[Supabase] Missing environment variables. Returning dummy client for build safety.')
  return {
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      getUser: async () => ({ data: { user: null }, error: null })
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: {}, error: null }),
          maybeSingle: async () => ({ data: null, error: null }),
          order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) })
        }),
        order: () => ({ execute: async () => ({ data: [], error: null }) })
      })
    }),
    storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: '' }, error: null }) }) }
  }
}

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !key) return dummyClient()

  // No servidor (SSR/build) NÃO usamos singleton: cada request deve ter sua própria
  // instância para não compartilhar sessão entre usuários.
  if (typeof window === 'undefined') return createBrowserClient(url, key)

  // No browser: reaproveita a mesma instância (referência estável).
  if (browserClient) return browserClient
  browserClient = createBrowserClient(url, key)
  return browserClient
}

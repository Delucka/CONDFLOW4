import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !key) {
    console.warn('[Supabase] Missing environment variables. Returning dummy client for build safety.')
    return {
      auth: { getSession: async () => ({ data: { session: null }, error: null }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }) },
      from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: null, error: null }) }) }) }),
      storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: null }) }) }
    }
  }

  return createBrowserClient(url, key)
}

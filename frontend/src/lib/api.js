import { createClient } from '@/utils/supabase/client';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

async function getAuthHeaders() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  const headers = { 'Content-Type': 'application/json' };
  
  if (session?.access_token) {
    headers['Authorization'] = `Bearer ${session.access_token}`;
  }
  
  return headers;
}

export async function apiFetch(path, opts = {}) {
  const headers = await getAuthHeaders();
  
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: { ...headers, ...opts.headers },
  });
  
  if (!res.ok) {
    let err = 'Erro na API';
    try {
      const data = await res.json();
      err = data.detail || err;
    } catch {
      err = await res.text();
    }
    throw new Error(err);
  }
  
  return res.json();
}

export async function apiPost(path, body) {
  return apiFetch(path, { method: 'POST', body: JSON.stringify(body) });
}

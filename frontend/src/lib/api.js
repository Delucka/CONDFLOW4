import { createClient } from '@/utils/supabase/client';

const API = process.env.NEXT_PUBLIC_API_URL || '';

async function getAuthHeaders() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  const headers = { 'Content-Type': 'application/json' };
  if (session?.access_token) {
    headers['Authorization'] = `Bearer ${session.access_token}`;
  }
  return headers;
}

export async function apiFetcher(url) {
  return apiFetch(url);
}

export async function apiFetch(path, opts = {}) {
  try {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API}${path}`, {
      ...opts,
      headers: { ...headers, ...opts.headers },
    });

    if (!response.ok) {
      let errorMessage = `Erro ${response.status}`;
      try {
        const text = await response.text();
        try {
          const json = JSON.parse(text);
          errorMessage = json.detail || json.message || errorMessage;
        } catch {
          errorMessage = text || errorMessage;
        }
      } catch {
        // ignora erro ao ler body
      }
      throw new Error(errorMessage);
    }

    return response.json();
  } catch (error) {
    console.error(`[API Error] ${path}:`, error.message);
    throw error;
  }
}

export async function apiPost(path, body) {
  return apiFetch(path, { method: 'POST', body: JSON.stringify(body) });
}

export async function apiPut(path, body) {
  return apiFetch(path, { method: 'PUT', body: JSON.stringify(body) });
}

export async function apiDelete(path) {
  return apiFetch(path, { method: 'DELETE' });
}

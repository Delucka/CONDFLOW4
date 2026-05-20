import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export async function GET() {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  
  const { data: d1, error: e1, count: c1 } = await supabase
    .from('emissoes_pacotes')
    .select('id', { count: 'exact', head: true })
    .ilike('status', '%solicitar%');
    
  const { data: d2, error: e2, count: c2 } = await supabase
    .from('emissoes_pacotes')
    .select('id', { count: 'exact', head: true })
    .or('status.ilike.%solicitar%,status.ilike.%correcao%');
    
  return NextResponse.json({
    ilike_count: c1,
    ilike_err: e1,
    or_count: c2,
    or_err: e2
  });
}

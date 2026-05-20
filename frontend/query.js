const fs = require('fs');
const envStr = fs.readFileSync('.env.local', 'utf8');
const env = {};
envStr.split('\n').forEach(l => {
  if(l && l.includes('=')) {
    const [k, ...v] = l.split('=');
    env[k.trim()] = v.join('=').trim().replace(/['"]/g, '');
  }
});
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
async function test() {
  const { data: p, error: ep } = await supabase.from('emissoes_pacotes').select('id, status').ilike('status', '%solicitar%');
  const { data: o, error: eo } = await supabase.from('emissoes_ocorrencias').select('id, status');
  console.log('Pacotes solicitando correcao:', p, ep);
  console.log('Ocorrencias:', o?.length, eo);
}
test();

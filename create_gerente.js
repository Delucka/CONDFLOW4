const fs = require('fs');
const env = fs.readFileSync('c:\\projetos\\condominios\\.env', 'utf8');
const URL = env.match(/SUPABASE_URL=(.*)/)[1].trim();
const KEY = env.match(/SUPABASE_SERVICE_KEY=(.*)/)?.[1]?.trim() || env.match(/SUPABASE_KEY=(.*)/)[1].trim();

async function createGerente() {
    const email = "gerenteoficial@condoadmin.com";
    const password = "Senha@1234gerente";
    
    // 1. Sign Up
    const resAuth = await fetch(`${URL}/auth/v1/signup`, {
        method: 'POST',
        headers: { 'apikey': KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
    });
    const authData = await resAuth.json();
    const uid = authData?.user?.id || authData?.id;
    
    if (uid) {
        console.log('User created:', uid);
        
        // 2. Profile
        await fetch(`${URL}/rest/v1/profiles?on_conflict=id`, {
            method: 'POST',
            headers: { 
                'apikey': KEY, 
                'Authorization': `Bearer ${KEY}`, 
                'Content-Type': 'application/json',
                'Prefer': 'resolution=merge-duplicates'
            },
            body: JSON.stringify({ id: uid, email, full_name: "Gerente Oficial", role: "gerente" })
        });
        
        // 3. Gerente carteira
        const resG = await fetch(`${URL}/rest/v1/gerentes?on_conflict=profile_id`, {
            method: 'POST',
            headers: { 
                'apikey': KEY, 
                'Authorization': `Bearer ${KEY}`, 
                'Content-Type': 'application/json',
                'Prefer': 'resolution=merge-duplicates,return=representation'
            },
            body: JSON.stringify({ profile_id: uid, limit_condos: 35 })
        });
        const gData = await resG.json();
        
        if (gData && gData[0]) {
            const gerenteId = gData[0].id;
            
            // 4. Atribuir primeiro condominio
            const resCondos = await fetch(`${URL}/rest/v1/condominios?select=id&limit=1`, {
                headers: { 'apikey': KEY, 'Authorization': `Bearer ${KEY}` }
            });
            const condos = await resCondos.json();
            
            if (condos && condos.length > 0) {
                await fetch(`${URL}/rest/v1/condominios?id=eq.${condos[0].id}`, {
                    method: 'PATCH',
                    headers: { 'apikey': KEY, 'Authorization': `Bearer ${KEY}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ gerente_id: gerenteId })
                });
                console.log('Condominio atribuido!');
            }
        }
        console.log(`\nEmail: ${email}\nSenha: ${password}`);
    } else {
        console.log("Error:", authData);
    }
}
createGerente().catch(console.error);

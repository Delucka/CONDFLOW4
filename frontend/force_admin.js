const path = require('path');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const envContent = fs.readFileSync(path.join(__dirname, '../.env'), 'utf8');
const URL = envContent.match(/SUPABASE_URL=(.*)/)?.[1]?.trim();
const KEY = envContent.match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/)?.[1]?.trim() || envContent.match(/SUPABASE_KEY=(.*)/)?.[1]?.trim();

if (!URL || !KEY) {
  console.log("Variáveis de ambiente não encontradas.");
  process.exit(1);
}

const supabase = createClient(URL, KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function run() {
    const email = "diretor@condoflow.com";
    const password = "SenhaDiretor@123";

    console.log("1. Criando Auth admin bypass...");
    const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
        email: email,
        password: password,
        email_confirm: true // BYPASS DE CONFIRMAÇÃO DE EMAIL
    });

    if (authErr) {
        console.error("Erro Auth:", authErr);
        if (!authErr.message.includes('already exists')) {
            process.exit(1);
        }
    }
    
    // Se falhou por já existir, precisa pegar o auth ID do bd mas a API não deixa tão simples por email, assumindo mock novo
    const uid = authData?.user?.id;
    if (!uid) {
        console.log("Usuário já existe, falhou criar do zero com admin.");
        process.exit(1);
    }

    console.log("2. Inserindo profile...");
    const { error: pErr } = await supabase.from('profiles').upsert({
        id: uid,
        email: email,
        full_name: "Diretor Teste (Gerente)",
        role: "gerente"
    });
    if (pErr) console.error(pErr);

    console.log("3. Inserindo gerente...");
    const { data: gData, error: gErr } = await supabase.from('gerentes').upsert({
        profile_id: uid,
        limit_condos: 35
    }).select();
    if (gErr) console.error(gErr);

    if (gData && gData.length > 0) {
        const gerenteId = gData[0].id;
        console.log("4. Vinculando Condominio...");
        const { data: cData } = await supabase.from('condominios').select('id').limit(1);
        if (cData && cData.length > 0) {
            await supabase.from('condominios').update({ gerente_id: gerenteId }).eq('id', cData[0].id);
            console.log("Condomínio VINCULADO COM SUCESSO!");
        }
    }

    console.log("\n=========================");
    console.log("SUCESSO ABSOLUTO!");
    console.log("Email:", email);
    console.log("Senha:", password);
    console.log("=========================");
}

run();

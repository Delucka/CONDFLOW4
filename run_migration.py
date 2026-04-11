"""Executa a migração SQL no Supabase via REST API"""
import os
import requests
from dotenv import load_dotenv

load_dotenv(override=True)

SB_URL = os.getenv("SUPABASE_URL", "")
SB_SERVICE = os.getenv("SUPABASE_SERVICE_KEY", "")

# Supabase expõe o endpoint /rest/v1/rpc para funções, mas para DDL
# precisamos usar a Management API ou o endpoint do PostgREST.
# A forma mais direta é via supabase-py com rpc, ou via HTTP direto ao pg.
# Vamos usar o endpoint SQL do Supabase (requer service_role key)

sql_file = os.path.join(os.path.dirname(__file__), "migrate_rateios.sql")
with open(sql_file, "r", encoding="utf-8") as f:
    sql = f.read()

# Supabase Management API para executar SQL
# Extrair o project ref da URL
project_ref = SB_URL.replace("https://", "").replace(".supabase.co", "")

# Usar o endpoint pg do Supabase para executar SQL via PostgREST
# Alternativa: usar psycopg2 diretamente
print(f"Project: {project_ref}")
print(f"SQL file loaded: {len(sql)} characters")
print()
print("=" * 60)
print("ATENÇÃO: Execute o SQL abaixo no Supabase SQL Editor:")
print(f"URL: {SB_URL}/project/{project_ref}/sql/new")
print("=" * 60)
print()

# Tenta usar supabase-py para executar via rpc
try:
    from supabase import create_client
    sb = create_client(SB_URL, SB_SERVICE)
    
    # Dividir SQL em statements individuais e executar cada um
    statements = [s.strip() for s in sql.split(";") if s.strip() and not s.strip().startswith("--")]
    
    success = 0
    errors = 0
    for i, stmt in enumerate(statements):
        if not stmt:
            continue
        try:
            # Usar rpc para executar SQL raw (requer função no banco)
            sb.postgrest.session.headers.update({
                "apikey": SB_SERVICE,
                "Authorization": f"Bearer {SB_SERVICE}",
                "Content-Type": "application/json",
                "Prefer": "return=minimal"
            })
            # Tentar via rpc
            resp = requests.post(
                f"{SB_URL}/rest/v1/rpc/",
                headers={
                    "apikey": SB_SERVICE,
                    "Authorization": f"Bearer {SB_SERVICE}",
                    "Content-Type": "application/json",
                },
                json={"query": stmt + ";"}
            )
            if resp.status_code < 300:
                success += 1
                print(f"  ✓ Statement {i+1} OK")
            else:
                # Tenta de outra forma
                raise Exception(resp.text)
        except Exception as e:
            errors += 1
            print(f"  ✗ Statement {i+1}: {str(e)[:80]}")
    
    if errors > 0:
        print(f"\n⚠ {errors} erros. Copie o SQL e execute manualmente no Supabase SQL Editor.")
        print(f"Acesse: https://supabase.com/dashboard/project/{project_ref}/sql/new")
    else:
        print(f"\n✓ Todas as {success} statements executadas com sucesso!")
        
except Exception as e:
    print(f"Não foi possível executar automaticamente: {e}")
    print(f"\nPor favor, copie o conteúdo de 'migrate_rateios.sql' e execute no:")
    print(f"https://supabase.com/dashboard/project/{project_ref}/sql/new")

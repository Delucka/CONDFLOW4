import os
from supabase import create_client
from dotenv import load_dotenv

load_dotenv(override=True)
url = os.getenv("SUPABASE_URL")
key = os.getenv("SUPABASE_SERVICE_KEY")

print(f"Testando conexão com {url}...")
try:
    supabase = create_client(url, key)
    res = supabase.table("profiles").select("count", count="exact").limit(1).execute()
    print(f"Sucesso! Encontrados {res.count} perfis.")
except Exception as e:
    print(f"Erro na conexão: {e}")

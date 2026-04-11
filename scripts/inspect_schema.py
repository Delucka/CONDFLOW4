import os
import httpx
from dotenv import load_dotenv

load_dotenv(override=True)
url = os.getenv("SUPABASE_URL")
key = os.getenv("SUPABASE_SERVICE_KEY")

if not url or not key:
    print("Credenciais ausentes.")
    exit(1)

# Consulta o OpenAPI do PostgREST para ver as colunas reais da tabela condominios
api_url = f"{url}/rest/v1/"
headers = {
    "apikey": key,
    "Authorization": f"Bearer {key}"
}

try:
    print(f"Consultando schema de {url}...")
    # Tenta descrever a tabela via RPC ou OpenAPI
    r = httpx.get(f"{api_url}?at=root", headers=headers)
    if r.status_code == 200:
        defs = r.json().get("definitions", {})
        condo_def = defs.get("condominios", {})
        props = condo_def.get("properties", {})
        print("Colunas encontradas em 'condominios':")
        for p in props.keys():
            print(f"  - {p}")
        
        if "limit_emissao" in props:
            print("\n✓ A coluna 'limit_emissao' EXISTE no schema!")
        else:
            print("\n✕ A coluna 'limit_emissao' NÃO FOI ENCONTRADA no schema.")
    else:
        print(f"Erro na consulta: {r.status_code}")
except Exception as e:
    print(f"Erro: {e}")

"""Fix: Insere/atualiza profile master na tabela profiles"""
import os
import httpx
from dotenv import load_dotenv
load_dotenv()

URL = os.getenv("SUPABASE_URL")
KEY = os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_KEY")
UID = "1326148f-0e86-47a0-b83e-4e4f69e70410"  # uid do denner.dlucka@gmail.com

headers = {
    "apikey": KEY,
    "Authorization": f"Bearer {KEY}",
    "Content-Type": "application/json",
    "Prefer": "resolution=merge-duplicates,return=representation"
}

print("Inserindo/atualizando profile master...")
with httpx.Client(timeout=15) as client:
    r = client.post(
        f"{URL}/rest/v1/profiles",
        headers=headers,
        json={
            "id": UID,
            "email": "denner.dlucka@gmail.com",
            "full_name": "Administrador Master",
            "role": "master"
        }
    )
    print(f"Status: {r.status_code}")
    print(f"Response: {r.text[:300]}")
    
    if r.status_code in (200, 201):
        print("\nProfile master criado/atualizado com sucesso!")
        print("Faça logout e login novamente para ver a mudança.")
    else:
        print(f"\nErro. Tentando UPDATE...")
        r2 = client.patch(
            f"{URL}/rest/v1/profiles?id=eq.{UID}",
            headers={**headers, "Prefer": "return=representation"},
            json={"role": "master", "full_name": "Administrador Master"}
        )
        print(f"UPDATE Status: {r2.status_code}")
        print(f"Response: {r2.text[:300]}")

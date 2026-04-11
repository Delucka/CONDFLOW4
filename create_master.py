"""Cria o usuario master via REST API direta do Supabase (sem SDK)"""
import os, json
import httpx
from dotenv import load_dotenv
load_dotenv()

URL = os.getenv("SUPABASE_URL")
KEY = os.getenv("SUPABASE_KEY")

headers = {
    "apikey": KEY,
    "Content-Type": "application/json",
}

print("Criando usuario no Supabase Auth...")
with httpx.Client(http2=False, timeout=15) as client:
    # 1. Sign up
    r = client.post(
        f"{URL}/auth/v1/signup",
        headers=headers,
        json={"email": "denner.dlucka@gmail.com", "password": "Denner@01"}
    )
    print(f"Status: {r.status_code}")
    data = r.json()

    if r.status_code in (200, 201):
        uid = data.get("id") or data.get("user", {}).get("id")
        print(f"Usuario criado! ID: {uid}")

        # 2. Insert profile
        print("Inserindo profile master...")
        r2 = client.post(
            f"{URL}/rest/v1/profiles",
            headers={**headers, "Authorization": f"Bearer {KEY}", "Prefer": "return=minimal"},
            json={"id": uid, "email": "denner.dlucka@gmail.com", "full_name": "Denner Dlucka", "role": "master"}
        )
        print(f"Profile status: {r2.status_code}")
        if r2.status_code >= 400:
            print(f"Profile response: {r2.text[:200]}")
            print("(Se a tabela nao existir, rode a migracao SQL primeiro)")
    else:
        print(f"Resposta: {json.dumps(data, indent=2)[:300]}")
        if "already" in str(data).lower():
            print("\nUsuario ja existe! Tente fazer login com denner.dlucka@gmail.com / Denner@01")

print("\nConcluido!")

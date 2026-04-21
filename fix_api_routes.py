import os

# 1. Carregar código base do arquivo de contexto (backup)
context_path = "PROJETO_CONDFLOW_CONTEXTO.md"
with open(context_path, "r", encoding="utf-8") as f:
    lines = f.readlines()

start_idx = -1
end_idx = -1
for i, line in enumerate(lines):
    if "## Arquivo: api/api_routes.py" in line:
        start_idx = i + 2 # Pula o nome do arquivo e o ```python
    if start_idx != -1 and "## Arquivo: api/index.py" in line:
        end_idx = i - 1 # Ponto final antes do próximo arquivo
        break

if start_idx == -1 or end_idx == -1:
    print("ERRO: Não foi possível encontrar api_routes.py no arquivo de contexto.")
    exit(1)

clean_code = "".join(lines[start_idx:end_idx]).strip()
if clean_code.endswith("```"):
    clean_code = clean_code[:-3].strip()

# 2. Carregar o patch do endpoint conferencia
patch_path = "patch_final/api/conferencia_endpoint.py"
with open(patch_path, "r", encoding="utf-8") as f:
    patch_code = f.read().strip()

# Remove comentários do topo do patch se houver
if "# COLE ESTE BLOCO" in patch_code:
    patch_code = patch_code.split("@router.get")[1]
    patch_code = "@router.get" + patch_code

# 3. Aplicar o patch no código limpo
# Substitui a função antiga pela nova
import re
pattern = r'(?s)@router\.get\("/condominio/\{condo_id\}/conferencia"\).*?(?=\n@router|\Z)'
final_code = re.sub(pattern, patch_code, clean_code)

# 4. Gravar o arquivo final
with open("api/api_routes.py", "w", encoding="utf-8") as f:
    f.write(final_code)

print("SUCESSO: api/api_routes.py restaurado e patcheado com sucesso!")

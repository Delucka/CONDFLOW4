import os
import zipfile

source_dir = r"C:\projetos\condominios"
output_filename = r"C:\projetos\condominios_backup.zip"

exclude_dirs = {'node_modules', 'venv', '.next', '.git', '__pycache__', 'artifacts'}
exclude_extensions = {'.zip'}

def make_zip():
    print(f"Creating {output_filename}...")
    with zipfile.ZipFile(output_filename, 'w', zipfile.ZIP_DEFLATED) as zipf:
        for root, dirs, files in os.walk(source_dir):
            if any(part in exclude_dirs for part in root.split(os.sep)):
                continue
            dirs[:] = [d for d in dirs if d not in exclude_dirs]
            
            for file in files:
                if any(file.endswith(ext) for ext in exclude_extensions):
                    continue
                file_path = os.path.join(root, file)
                arcname = os.path.relpath(file_path, source_dir)
                zipf.write(file_path, arcname)
    print("Done!")

if __name__ == '__main__':
    make_zip()

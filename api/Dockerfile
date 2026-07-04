# API CondoFlow na VPS (atrás do Traefik do n8n) — processo sempre vivo, sem cold start
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt "gunicorn>=21"
COPY . .
EXPOSE 8001
# supabase-py é síncrono (bloqueia o worker durante a query). Com 4 workers
# atendemos 4 chamadas simultâneas — o SWR dispara várias por página, então
# isso reduz fila. VPS tem 2 cores + 6GB livres, folga de sobra.
CMD ["gunicorn", "index:app", "-k", "uvicorn.workers.UvicornWorker", \
     "-w", "4", "-b", "0.0.0.0:8001", "--timeout", "120", \
     "--access-logfile", "-", "--error-logfile", "-"]

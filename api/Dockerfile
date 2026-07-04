# API CondoFlow na VPS (atrás do Traefik do n8n) — processo sempre vivo, sem cold start
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt "gunicorn>=21"
COPY . .
EXPOSE 8001
CMD ["gunicorn", "index:app", "-k", "uvicorn.workers.UvicornWorker", \
     "-w", "2", "-b", "0.0.0.0:8001", "--timeout", "120", \
     "--access-logfile", "-", "--error-logfile", "-"]

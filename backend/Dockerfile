# JobPilot API (FastAPI + LangGraph + Playwright) for Google Cloud Run
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt \
 && playwright install --with-deps chromium \
 && rm -rf /var/lib/apt/lists/*

COPY app ./app

# Run as a non-root user
RUN useradd --create-home --uid 10001 jobpilot && chown -R jobpilot /app /ms-playwright
USER jobpilot

# Cloud Run sets $PORT (default 8080). Secrets come from Cloud Run env vars / Secret Manager, never from the image.
CMD exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080} --proxy-headers --forwarded-allow-ips="*"

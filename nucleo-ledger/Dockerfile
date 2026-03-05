FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./requirements.txt
RUN python -m pip install --upgrade pip && python -m pip install -r requirements.txt

# Capture git SHA at build time — exposed as APP_GIT_SHA env var inside the container.
# Build with: docker build --build-arg APP_GIT_SHA=$(git rev-parse --short HEAD) .
ARG APP_GIT_SHA=unknown
ENV APP_GIT_SHA=$APP_GIT_SHA

COPY ledger_app ./ledger_app

EXPOSE 8000

CMD ["uvicorn", "ledger_app.main:app", "--host", "0.0.0.0", "--port", "8000"]

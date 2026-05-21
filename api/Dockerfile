FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY api/requirements.txt ./requirements.txt
RUN python -m pip install --upgrade pip && python -m pip install -r requirements.txt

# Capture git SHA at build time for audit trail
ARG APP_GIT_SHA=unknown
ENV APP_GIT_SHA=$APP_GIT_SHA

# Shared JWT library
COPY api/shared_auth ./shared_auth

# Ledger application package (17 routers + all services)
COPY api/ledger_app ./ledger_app

# Consolidated app package (narrative pipeline router + service layer)
COPY api/app ./app

# Consolidated entry point
COPY api/main.py ./main.py

EXPOSE 8000

CMD uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}

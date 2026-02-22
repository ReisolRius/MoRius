# Microservices Runtime Layout

This project now supports service-level runtime splits from one shared codebase.

## Services

- `gateway` (default): exposes all public API routes
- `auth`: only `/api/auth/*`
- `story`: only `/api/story/*`
- `payments`: only `/api/payments/*`

Each service has its own FastAPI entrypoint:

- `app.microservices.gateway_main:app`
- `app.microservices.auth_main:app`
- `app.microservices.story_main:app`
- `app.microservices.payments_main:app`

## Start Commands

PowerShell examples:

```powershell
# Gateway (default), port 8000
$env:APP_MODE = "gateway"; python run.py

# Auth service, port 8001
$env:APP_MODE = "auth"; $env:PORT = "8001"; python run.py

# Story service, port 8002
$env:APP_MODE = "story"; $env:PORT = "8002"; python run.py

# Payments service, port 8003
$env:APP_MODE = "payments"; $env:PORT = "8003"; python run.py
```

If `PORT` is not set, `run.py` uses default ports by service mode.

Start all services in one command (dev):

```powershell
python run_services.py
```

## Startup Optimization

- `DB_BOOTSTRAP_ON_STARTUP=true|false`
  - `true`: run schema/bootstrap checks on startup
  - `false`: skip bootstrap work (recommended for leaf services)
- `APP_GZIP_ENABLED=true|false`
- `APP_GZIP_MINIMUM_SIZE=1024`
- `APP_TRUST_PROXY_HEADERS=true|false`
- `APP_FORWARDED_ALLOW_IPS=*`
- `APP_ALLOWED_HOSTS=*` (for production set explicit host list)
- `DB_POOL_SIZE` and `DB_MAX_OVERFLOW`
  - if not set, defaults are selected by `APP_MODE`
  - `gateway/monolith`: `20/40`
  - `story`: `16/24`
  - `auth` and `payments`: `8/12`
- `WEB_CONCURRENCY`
  - if not set, defaults are selected by `APP_MODE`
  - `gateway/monolith`: `2`
  - `story`: `2`
  - `auth` and `payments`: `1`
- `UVICORN_BACKLOG` (default `2048`)
- `UVICORN_TIMEOUT_KEEP_ALIVE` (default `5`)
- `UVICORN_TIMEOUT_GRACEFUL_SHUTDOWN` (default `30`)
- `UVICORN_LIMIT_CONCURRENCY` (empty by default = no explicit limit)
- `UVICORN_LOG_LEVEL` (default `info`)
- `UVICORN_ACCESS_LOG` (`true|false`, default `true`)

## Frontend Routing

Frontend can now target service-specific origins:

- `VITE_API_URL` (fallback/default)
- `VITE_AUTH_API_URL`
- `VITE_STORY_API_URL`
- `VITE_PAYMENTS_API_URL`

If service URLs are not provided, frontend falls back to `VITE_API_URL`.

## Render + Vercel (Current Setup)

For a single Render web service (gateway mode):

- `APP_MODE=gateway`
- `DB_BOOTSTRAP_ON_STARTUP=true`
- `APP_GZIP_ENABLED=true`
- `APP_GZIP_MINIMUM_SIZE=1024`

Vercel frontend env examples:

- `VITE_API_URL=https://your-render-backend.onrender.com`
- `VITE_AUTH_API_URL=https://your-render-backend.onrender.com`
- `VITE_STORY_API_URL=https://your-render-backend.onrender.com`
- `VITE_PAYMENTS_API_URL=https://your-render-backend.onrender.com`

You can later split backend into several Render services by setting each `APP_MODE` (`auth`, `story`, `payments`) and pointing Vercel vars to different service URLs.

## VPS Target (All Services on One Server)

Root-level files for VPS deployment:

- `docker-compose.vps.yml`
- `deploy/vps/nginx-edge.conf`
- `.env.vps.example`

Minimal start:

```bash
cp .env.vps.example .env
docker compose -f docker-compose.vps.yml --env-file .env up -d --build
```

In this mode:

- frontend is served from container `frontend`
- edge nginx routes `/api/auth/*`, `/api/story/*`, `/api/payments/*` to corresponding services
- PostgreSQL runs in `postgres`

## Load Testing

Quick local benchmark for any endpoint (no extra deps required, uses `requests`):

```powershell
cd backend
python scripts/load_test.py --base-url http://127.0.0.1:8000 --path /api/health --duration 20 --concurrency 50
```

Useful flags:

- `--method GET|POST|PATCH|DELETE`
- `--expected-status 200`
- `--header "Authorization: Bearer <token>"`
- `--body-json "{\"key\":\"value\"}"`
- `--min-success-rate 99`
- `--output-json load-report.json`

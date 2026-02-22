# Render Deployment Notes

## Single Backend Service (Recommended now)

- Runtime: `Python`
- Root directory: `backend`
- Build command: `pip install -r requirements.txt`
- Start command: `python run.py`

Required env:

- `APP_MODE=gateway`
- `DB_BOOTSTRAP_ON_STARTUP=true`
- `APP_GZIP_ENABLED=true`
- `APP_GZIP_MINIMUM_SIZE=1024`
- `APP_TRUST_PROXY_HEADERS=true`
- `APP_FORWARDED_ALLOW_IPS=*`
- `APP_ALLOWED_HOSTS=your-render-backend.onrender.com`
- `DATABASE_URL` (Render Postgres recommended)
- `JWT_SECRET_KEY`
- `CORS_ORIGINS=https://your-vercel-domain.vercel.app`

## Split Services on Render (Later)

Create three additional services from the same codebase:

- `APP_MODE=auth`, `DB_BOOTSTRAP_ON_STARTUP=false`
- `APP_MODE=story`, `DB_BOOTSTRAP_ON_STARTUP=false`
- `APP_MODE=payments`, `DB_BOOTSTRAP_ON_STARTUP=false`

Keep one bootstrap owner (`gateway` or `monolith`) with:

- `DB_BOOTSTRAP_ON_STARTUP=true`

In Vercel, point:

- `VITE_AUTH_API_URL` to auth service URL
- `VITE_STORY_API_URL` to story service URL
- `VITE_PAYMENTS_API_URL` to payments service URL

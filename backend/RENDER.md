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
- `YOOKASSA_SHOP_ID`
- `YOOKASSA_SECRET_KEY`
- `YOOKASSA_API_URL=https://api.yookassa.ru/v3`
- `PAYMENTS_RETURN_URL=https://your-vercel-domain.vercel.app/dashboard`
- `YOOKASSA_WEBHOOK_TOKEN=<strong-random-token>`
- `YOOKASSA_WEBHOOK_TRUSTED_IPS_ONLY=true`
- `YOOKASSA_RECEIPT_ENABLED=true`
- `YOOKASSA_RECEIPT_VAT_CODE=1`
- `YOOKASSA_RECEIPT_PAYMENT_MODE=full_payment`
- `YOOKASSA_RECEIPT_PAYMENT_SUBJECT=service`

YooKassa webhook URL in merchant cabinet:

- `https://your-render-backend.onrender.com/api/payments/yookassa/webhook?token=<YOOKASSA_WEBHOOK_TOKEN>`

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

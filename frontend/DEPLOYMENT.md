# Frontend Deployment Notes

## Vercel (with Render backend now)

Set env vars in Vercel project:

- `VITE_API_URL=https://your-render-backend.onrender.com`
- `VITE_AUTH_API_URL=https://your-render-backend.onrender.com`
- `VITE_STORY_API_URL=https://your-render-backend.onrender.com`
- `VITE_PAYMENTS_API_URL=https://your-render-backend.onrender.com`

## Vercel (with split backend services later)

- `VITE_AUTH_API_URL=https://your-auth-service.onrender.com`
- `VITE_STORY_API_URL=https://your-story-service.onrender.com`
- `VITE_PAYMENTS_API_URL=https://your-payments-service.onrender.com`

`VITE_API_URL` remains fallback and can be set to gateway or left empty.

## VPS (single domain with reverse proxy)

When frontend and backend are behind one domain, build frontend with empty service URLs:

- `VITE_API_URL=`
- `VITE_AUTH_API_URL=`
- `VITE_STORY_API_URL=`
- `VITE_PAYMENTS_API_URL=`

Then requests are same-origin (`/api/...`) and routed by edge nginx.

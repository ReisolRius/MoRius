# Backend (FastAPI)

Реализовано:

- Регистрация по `email + пароль`
- Авторизация по `email + пароль`
- Вход через Google (`id_token` верифицируется на бэке)
- JWT-сессия
- SQLite база (`backend/data/morius.db`)
- Профиль пользователя с `avatar_url` (для Google подтягивается автоматически)

## Быстрый запуск

1. Перейти в папку:
   - `cd backend`
2. Создать и активировать виртуальное окружение:
   - Windows PowerShell:
   - `python -m venv .venv`
   - `.venv\Scripts\Activate.ps1`
3. Установить зависимости:
   - `pip install -r requirements.txt`
4. Создать `.env`:
   - `copy .env.example .env`
5. Запустить сервер:
   - `python run.py`
   - или `uvicorn app.main:app --reload --host 0.0.0.0 --port 8000`

## ENV переменные

- `DATABASE_URL` (по умолчанию `sqlite:///./data/morius.db`)
- `JWT_SECRET_KEY`
- `ACCESS_TOKEN_TTL_MINUTES`
- `CORS_ORIGINS` (например `http://localhost:5173`)
- `GOOGLE_CLIENT_ID` (обязателен для Google login)

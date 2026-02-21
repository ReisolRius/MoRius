from app.main import app

# Optional entrypoint for `python run.py`
if __name__ == "__main__":
    import os

    import uvicorn

    host = os.getenv("HOST", "0.0.0.0").strip() or "0.0.0.0"
    raw_port = os.getenv("PORT", "8000").strip()
    port = int(raw_port) if raw_port.isdigit() else 8000
    reload_enabled = os.getenv("UVICORN_RELOAD", "0").strip().lower() in {"1", "true", "yes", "on"}

    uvicorn.run("app.main:app", host=host, port=port, reload=reload_enabled)

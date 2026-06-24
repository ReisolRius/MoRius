# Backend Audit

Первый проход по backend MoRius-AI. Цель этого документа - зафиксировать карту системы и опасные зоны перед дальнейшей стабилизацией, без переписывания рабочих сценариев.

## Карта backend

- Приложение создается в `backend/app/main.py`: `FastAPI(...)` объявлен около блока подключения middleware, startup/shutdown и frontend fallback.
- Роутеры подключаются в `backend/app/main.py`: auth, downloads, health, payments, referrals, story cards/characters/generate/graph/messages/read/undo/world cards, shop и опциональные admin/profiles/dashboard/media/story_games/admin_moderation/ai_assistant.
- Конфиг находится в `backend/app/config.py`: env читается через `Settings`, `.env` и `dotenv_values`; часть таймаутов все еще живет константами вне централизованного config.
- БД/session находятся в `backend/app/database.py`: sync SQLAlchemy engine/session, SQLite WAL/busy_timeout, `get_db()` делает rollback на исключении и close в finally.
- Авторизация: `backend/app/routers/auth.py`, `backend/app/security.py`, `backend/app/services/auth_identity.py`, `backend/app/services/auth_verification.py`, OAuth-сервисы `yandex_oauth.py` и `vk_id_oauth.py`.
- Платежи: `backend/app/routers/payments.py`, `backend/app/services/payments.py`, модель `CoinPurchase`, атомарное начисление в `backend/app/services/concurrency.py`.
- Генерация ИИ: endpoint `POST /api/story/games/{game_id}/generate` в `backend/app/routers/story_generate.py`, вход в `backend/app/services/story_generation_entry.py`, основной pipeline в `backend/app/services/story_runtime.py`, провайдеры/stream в `backend/app/services/story_generation_provider.py`.
- Списание солов: `spend_user_tokens_if_sufficient()` в `backend/app/services/concurrency.py`; story-turn списывается в `backend/app/services/story_runtime.py` после сохранения assistant message и перед postprocess/memory sync.
- Стриминг: `_stream_story_response()` в `backend/app/services/story_runtime.py`; provider SSE/HTTP stream в `backend/app/services/story_generation_provider.py`.
- Отмена генерации: endpoint `POST /api/story/games/{game_id}/generation/cancel`, in-memory registry в `backend/app/services/story_generation_cancel.py`.
- Undo/reroll/rollback: `backend/app/routers/story_undo.py`, `backend/app/services/story_undo.py`, а также подготовка reroll/rollback внутри `backend/app/services/story_runtime.py`.
- Lock-и генерации: `backend/app/services/story_game_operation_lock.py`; in-process lock + PostgreSQL advisory lock, release привязан к завершению stream response/background.
- Провайдеры ИИ: `backend/app/services/story_generation_provider.py`, `backend/app/services/proxyapi_fallback.py`, часть legacy/helper кода все еще в `backend/app/main.py`.
- Админка: `backend/app/routers/admin.py`, `backend/app/routers/admin_moderation.py`.
- Медиа/картинки/аудио: `backend/app/routers/media.py`, `backend/app/routers/story_turn_image.py`, `backend/app/routers/story_turn_audio.py`, `backend/app/services/media.py`, `backend/app/services/story_visuals.py`.

## Что уже выглядит устойчиво

- Платежные webhook/sync не должны начислять солы дважды при нормальной транзакции: `CoinPurchase.provider_payment_id` уникален, а `grant_purchase_coins_once()` обновляет `coins_granted_at IS NULL` перед начислением.
- Списание солов для story-turn не происходит до provider stream: в текущем pipeline сначала создается/сохраняется assistant message и проверяется ненулевой ответ.
- Есть lock от параллельной генерации одной игры: локальный mutex и PostgreSQL advisory lock.
- Для SQLite включены `busy_timeout`, `foreign_keys`, опциональный WAL и retry commit через `sqlite_write_guard`.
- `/api/health` существует и возвращает простой `{"message":"ok"}`.

## Главные проблемные зоны

- `backend/app/main.py` слишком большой: около 13.6k строк. В нем смешаны создание приложения, fallback routes, prompt building, provider calls, memory/postprocess helpers, image generation, emotion jobs и frontend static fallback.
- Есть сильные циклические/legacy зависимости на monolith: `story_generation_entry.py`, `story_generation_provider.py` и `story_visuals.py` импортируют `app.main` и подтягивают из него globals. Это делает импорт хрупким и усложняет тестирование.
- `backend/app/routers/story_generate.py` содержит большой fallback runtime и дублирует часть логики `story_runtime.py`; это повышает риск расхождения поведения.
- `backend/app/services/story_runtime.py` содержит много ответственности: подготовка turn, rollback/reroll, lock lifecycle, stream, billing, postprocess, memory, graph, VN payload.
- Lock-и генерации не имеют явного TTL на уровне локального registry. При штатном stream release это ок, но при зависшем worker/process или незавершенном ответе in-memory состояние живет до рестарта процесса; PostgreSQL advisory lock освобождается с connection close, локальный lock - только через release.
- Отмена генерации хранится только в памяти процесса. В multi-worker/microservice режиме cancel может не попасть в тот worker, где идет stream.
- Таймауты разрознены и частично хардкодятся: story provider stream `20/90/180`, first-token `120`, postprocess `4/7`, graph `8/150`, payments `20`, OAuth `4/12`, image generation до `600`. Не все вынесено в env/config.
- В sync FastAPI endpoints много blocking IO через `requests` и `time.sleep`; это приемлемо для sync routes, но при высокой нагрузке занимает worker thread и может давать очереди/504.
- В проекте много широких `except Exception`. Часть оправдана best-effort postprocess/fallback, но есть риск проглатывания настоящих ошибок с `return None`.
- Есть глобальные mutable-состояния: HTTP sessions, GigaChat token cache, story generation cancel registry, operation lock registry, service request budgets/context vars.
- Postprocess после успешного ответа запускается после списания солов. Если memory/graph/postprocess падает, ответ и списание сохраняются, но состояние игры может быть частично обновлено; сейчас это частично покрыто `postprocess_pending/failed`, но модель статусов генерации не выделена явно.
- Финальная модель статуса генерации не материализована в БД как `started/streaming/completed/failed/cancelled`; сейчас есть in-memory generation id и stream events.
- Потенциальные N+1/дорогие места: community/story listing в `routers/story_games.py`, graph build/analyze в `services/story_graph.py`, memory/card selection вокруг каждого turn. Нужен отдельный профилирующий проход.
- В repo/workspace есть `__pycache__` и локальные окружения. `.gitignore` уже игнорирует основные Python cache/venv, но рабочее дерево стоит почистить от проектных cache.
- В репозитории лежит `backend/app.rar`. Это бинарный архив с кодом/приложением; надо отдельно решить, нужен ли он в git дальше.

## Риски по инвариантам

- Солы: story-turn списывается только после provider response и persisted assistant message, но до всего postprocess. Это защищает пользователя от оплаты пустого provider ответа, но не дает полной transactional-модели "ответ + все вторичные изменения".
- Ошибка после частичного stream: при provider exception assistant message удаляется и error event отдается; при client cancel partial output может сохраняться без списания, что выглядит безопаснее для баланса, но неочевидно для UX.
- Отмена: cancel idempotent на одном процессе, но не надежна между несколькими workers.
- Lock-и: есть защита от двойного запуска, но нет persistent/TTL lock. Зависание процесса лечится рестартом/connection close, а не явной очисткой статуса в БД.
- Платежи: начисление защищено атомарным `coins_granted_at IS NULL`; webhook при ошибке провайдера отвечает `ignored`, что безопасно для баланса, но может скрывать проблемы observability.
- Auth/session: токены stateless JWT, `get_db()` делает rollback/close; при падении одного endpoint session не должна сохраняться открытой, но широкие fallback imports в main могут мешать startup diagnostics.

## Рекомендации по первому безопасному циклу

1. Добавить smoke/regression тесты вокруг startup/import/health, story lock release/cancel, billing after successful stream и no charge on provider failure.
2. Очистить только проектные `__pycache__`/`.pyc`, не трогая `.venv`, `node_modules`, Android SDK и recovery snapshots.
3. Вынести явные timeout settings в `config.py` без изменения defaults, затем заменить хардкод в provider/payment/story modules.
4. Добавить persistent generation status model/table или хотя бы service abstraction, прежде чем менять pipeline.
5. Убрать импорты `app.main` из `story_generation_entry.py`, `story_generation_provider.py`, `story_visuals.py` постепенно: сначала тесты, затем перенос конкретных helpers из monolith.
6. Держать публичные routes/schema без изменений, пока frontend не проверен.

## Минимальные проверки после следующих изменений

- `cd backend; python -m pytest tests/test_story_generation_locking.py tests/test_story_service_model_resilience.py tests/test_story_memory_compression.py`
- `cd backend; python -m pytest tests`
- `cd backend; python -c "from app.main import app; print(app.title)"`
- Проверить `/api/health` через TestClient или запущенный сервер.

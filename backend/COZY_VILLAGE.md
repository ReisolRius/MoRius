# Cozy Village — бэкенд игры внутри MoRius

Игра — **гость** в этом бэкенде, а не его часть. Отдельный пакет (`app/cozy/`), отдельный
контейнер, отдельная база и отдельные токены. Ни одна строчка не пишет в таблицы MoRius, ни одна
строчка MoRius не читает таблицы игры.

Переиспользуется только то, что не про личность: почтовик (`app/services/auth_verification.py`),
хеширование паролей и кодек JWT (`app/security.py`). Второй экземпляр каждого был бы вторым
местом, которое надо держать правильным.

## Что появилось

| Файл | Зачем |
|---|---|
| `app/cozy/settings.py` | Настройки игры из env. Имя базы выводится из `DATABASE_URL` MoRius |
| `app/cozy/database.py` | Свой engine и `CozyBase`; создаёт базу `cozyvillage`, если её нет |
| `app/cozy/models.py` | `cozy_players`, `cozy_email_codes`, `cozy_saves`, `cozy_google_logins`, `cozy_purchases` |
| `app/cozy/security.py` | Токены с клеймом `app: cozy-village` и проверка на входе |
| `app/cozy/mail.py` | Тексты писем — про Cozy Village, отправка через почтовик MoRius |
| `app/cozy/routers/auth.py` | Регистрация с кодом, вход, сброс пароля, Google |
| `app/cozy/routers/save.py` | Облачное сохранение: `GET` / `PUT` |
| `app/cozy/routers/payments.py` | ЮKassa: статус, создание платежа, вебхук, выдача покупок |
| `app/cozy/main.py`, `app/microservices/cozy_main.py` | Приложение и точка входа сервиса |
| `tests/test_cozy_backend.py` | 14 тестов: коды, токены, конфликты сейвов, покупки |

Изменены три существующих файла, все — аддитивно:

- `run.py` — режим `cozy` (порт 8004)
- `docker-compose.vps.yml` — сервис `cozy`
- `deploy/vps/nginx-edge.conf` — `location /api/cozy/`

## Развёртывание

```bash
cd /path/to/morius
git pull
docker compose -f docker-compose.vps.yml up -d --build cozy
docker compose -f docker-compose.vps.yml up -d --force-recreate edge
curl -s http://127.0.0.1/api/cozy/health
```

Ожидаемый ответ: `{"status":"ok","service":"cozy","payments":false,"google":false}`.

Базу создавать руками не нужно: сервис при старте подключается к `postgres` и делает
`CREATE DATABASE cozyvillage`, если её нет, затем `create_all`. Init-скрипт образа не подошёл бы —
он выполняется только на пустом data-каталоге, а этот сервер давно не пустой.

**MoRius не трогается.** Пересобирается только контейнер `cozy` и пересоздаётся `edge` (ему нужен
новый конфиг nginx). `edge` зависит от `cozy` как `service_started`, а не `service_healthy` — сайт
не должен ждать игру и тем более не должен из-за неё не подняться.

## Переменные окружения

Всё необязательное. Игра работает без Google и без кассы — просто говорит об этом вслух.

| Переменная | По умолчанию | Что делает |
|---|---|---|
| `COZY_DATABASE_NAME` | `cozyvillage` | Имя базы на том же Postgres |
| `COZY_DATABASE_URL` | выводится | Полный URL, если база живёт отдельно |
| `COZY_ACCESS_TOKEN_TTL_DAYS` | `180` | Срок сессии. Телефонная игра: полгода, не часы |
| `COZY_EMAIL_CODE_TTL_MINUTES` | `15` | Сколько живёт код из письма |
| `COZY_EMAIL_RESEND_COOLDOWN_SECONDS` | `60` | Пауза между письмами на один адрес |
| `COZY_GOOGLE_CLIENT_ID` | `GOOGLE_CLIENT_ID` | Можно взять клиент MoRius — компания та же |
| `COZY_GOOGLE_CLIENT_SECRET` | пусто | **Нужен**: игра меняет `code` на токен на сервере |
| `COZY_GOOGLE_REDIRECT_URI` | `https://morius-ai.ru/api/cozy/auth/google/callback` | Должен быть в консоли Google |
| `COZY_YOOKASSA_SHOP_ID` | пусто | Пока пусто — магазин честно пишет «оплата не подключена» |
| `COZY_YOOKASSA_SECRET_KEY` | пусто | |
| `COZY_YOOKASSA_RETURN_URL` | `.../api/cozy/payments/done` | Куда ЮKassa вернёт браузер |
| `COZY_YOOKASSA_WEBHOOK_TOKEN` | пусто | Если задан, вебхук требует заголовок `X-Cozy-Webhook-Token` |

Почта берётся из тех же `RESEND_*` / `SMTP_*`, что и у MoRius: отправитель один, а игру называет
первая строка письма.

## Google

Вход идёт **через системный браузер**, без плагина в игре: сервер выдаёт одноразовый билет, телефон
открывает страницу согласия, сервер принимает `code` и кладёт готовый токен против билета, игра
спрашивает про билет раз в две секунды.

Нативный SDK потребовал бы отпечаток подписи APK, зарегистрированный в консоли, — то есть вход,
который работает в одной сборке и молча ломается в следующей, собранной на другой машине.

**Почему нельзя просто взять то, что на сайте.** У MoRius вход через Google сделан библиотекой
Google Identity Services — она живёт в браузере, показывает окно выбора аккаунта и отдаёт готовый
`id_token`; сервер его только проверяет. Серверная половина здесь и переиспользована один в один
(`_verify_google_id_token` + поиск игрока по `sub`). Чего в телефоне нет — самой библиотеки:
браузерного GIS в Unity не существует, а нативный SDK требует отпечаток подписи APK,
зарегистрированный в консоли, то есть вход, работающий в одной сборке и молча ломающийся
в следующей, собранной на другой машине.

Поэтому игра идёт в системный браузер за `code`, а сервер меняет его на токен. Обмен `code` →
токен Google разрешает только с client secret — отсюда единственная новая настройка.

Что нужно в Google Cloud Console (тот же проект, что у MoRius):

1. **Credentials → OAuth 2.0 Client IDs → веб-клиент** (тот, чей id уже в `GOOGLE_CLIENT_ID`).
2. **Authorized redirect URIs** → добавить `https://morius-ai.ru/api/cozy/auth/google/callback`.
3. Скопировать **Client secret** → положить в `COZY_GOOGLE_CLIENT_SECRET`.

Проверка — `/api/cozy/auth/google/config`, он говорит, чего не хватает, не раскрывая секрета:

```json
{"ready": true, "client_id_set": true, "client_id_tail": "...apps.googleusercontent.com",
 "client_secret_set": true, "redirect_uri": "https://morius-ai.ru/api/cozy/auth/google/callback"}
```

`redirect_uri` в этом ответе обязан совпадать с тем, что вписан в консоли, **символ в символ** —
Google сверяет строку целиком, и лишний слэш на конце это другой URI.

Пока не настроено, `/api/cozy/auth/google/start` отвечает 503 с перечислением недостающего
(«нет client secret»), и игра показывает это игроку вместо молчащей кнопки.

## ЮKassa

Код написан целиком и выключен одним условием: без `COZY_YOOKASSA_SHOP_ID` и
`COZY_YOOKASSA_SECRET_KEY` эндпоинт создания платежа отвечает 503 с понятным текстом, а игра
рисует это на карточке вместо кнопки.

Когда магазин появится:

1. `COZY_YOOKASSA_SHOP_ID`, `COZY_YOOKASSA_SECRET_KEY`, `COZY_YOOKASSA_RETURN_URL` в env.
2. В личном кабинете ЮKassa — вебхук на `https://morius-ai.ru/api/cozy/payments/yookassa/webhook`,
   события `payment.succeeded` и `payment.canceled`.
3. `docker compose -f docker-compose.vps.yml up -d cozy`.

Самоцветы выдаёт игра, право на них хранит сервер: строка остаётся в статусе `paid`, пока телефон
не заберёт её и не подтвердит. Поэтому покупка переживает закрытую вкладку, пропавшую связь и
переустановку раньше, чем пришёл чек.

## Эндпоинты

```
POST /api/cozy/auth/register              {email, password}      → письмо с кодом
POST /api/cozy/auth/register/verify       {email, code}          → токен
POST /api/cozy/auth/login                 {email, password}      → токен
POST /api/cozy/auth/password-reset        {email}                → письмо с кодом
POST /api/cozy/auth/password-reset/verify {email, code, password}→ токен
POST /api/cozy/auth/google/start                                 → {state, auth_url}
GET  /api/cozy/auth/google/callback       (браузер)
GET  /api/cozy/auth/google/poll?state=                           → pending | ready | failed
GET  /api/cozy/auth/me                                           → игрок

GET  /api/cozy/save                                              → сейв или exists:false
PUT  /api/cozy/save                       {payload, base_revision, force}

GET  /api/cozy/payments/status                                   → configured
POST /api/cozy/payments/create            {product_id, gems, amount_roubles}
GET  /api/cozy/payments/pending                                  → оплаченное, не выданное
POST /api/cozy/payments/{id}/ack                                 → «забрал»
POST /api/cozy/payments/{id}/sync                                → спросить кассу напрямую
POST /api/cozy/payments/yookassa/webhook
```

## Тесты

```bash
cd backend
python -m unittest tests.test_cozy_backend -v
```

Четырнадцать штук, без сети и без почтового сервера. Главный из них —
`test_a_morius_token_cannot_open_a_cozy_account`: секрет у продуктов один, поэтому токен MoRius
здесь декодируется идеально, и клейм `app` — единственное, что мешает пользователю MoRius №5
оказаться игроком Cozy Village №5.

# MoRius Android App

React Native приложение для Android, которое открывает мобильную версию MoRius через `WebView`.

## Что открывается

- Стартовый URL: `https://morius-ai.ru/auth`
- Если в WebView уже есть сохраненная сессия, сайт сам переведет пользователя на `/dashboard`.
- Переход на корневую страницу `https://morius-ai.ru/` внутри приложения автоматически возвращается на `/auth`, чтобы APK не показывал презентационную страницу.
- API-запросы идут как на сайте: через тот же домен и прокси `/api` на VPS.

## Разработка

```powershell
cd androidApp
npm install
npm run start
```

Expo SDK 56 ожидает Node `^20.19.4`, `^22.13.0`, `^24.3.0` или новее.

Для запуска на подключенном Android-устройстве или эмуляторе:

```powershell
npm run android
```

## APK

Через EAS Build:

```powershell
cd androidApp
npm run build:apk
```

Профиль `preview` в `eas.json` собирает именно APK. Команда использует `npx eas-cli`, поэтому отдельная локальная зависимость `eas-cli` не нужна. Для Google Play используйте:

```powershell
npm run build:aab
```

Локально через Gradle, если установлен Android SDK:

```powershell
cd androidApp
npm run prebuild:android
cd android
.\gradlew assembleRelease
```

APK появится в `android\app\build\outputs\apk\release`.

## Настройки

Основной домен лежит в `src/config.ts`. Если сервер переедет, поменяйте `MORIUS_SITE_ORIGIN`.

## Google Sign-In Android OAuth

The native Google Sign-In flow is tied to the exact Android package and signing certificate of the APK.

Current local APK identity:

- Package name: `ru.morius.app`
- SHA-1: `5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25`
- Android OAuth client ID: `990879053044-4u4litr626f2i1s1h19089tovflrovf6.apps.googleusercontent.com`
- Native sign-in web client ID: `990879053044-vubp6ad3prcllj34ou11rto4vmin6l5k.apps.googleusercontent.com`

If Google Sign-In shows `DEVELOPER_ERROR`, create or update an Android OAuth client in the same Google Cloud/Firebase project with that package name and SHA-1. Keep the web client ID in `src/config.ts`, `frontend/.env`, and `backend/.env`.

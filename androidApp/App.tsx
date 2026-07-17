import { StatusBar } from 'expo-status-bar'
import { useCallback, useEffect, useMemo, useRef, useState, type ElementRef } from 'react'
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Image,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { GoogleSignin, isErrorWithCode, isSuccessResponse } from '@react-native-google-signin/google-signin'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { WebView } from 'react-native-webview'

import {
  GOOGLE_WEB_CLIENT_ID,
  MORIUS_GOOGLE_AUTH_URL,
  MORIUS_ENTRY_URL,
  MORIUS_SITE_ORIGIN,
  buildMoriusEntryUrlFrom,
  isHttpUrl,
  isMoriusRootUrl,
} from './src/config'

type NativeRouteMessage = {
  type: 'route'
  href: string
  pathname: string
}

type NativeGoogleSignInMessage = {
  type: 'googleSignIn'
}

type NativeBridgeMessage = NativeRouteMessage | NativeGoogleSignInMessage

type AuthResponse = {
  access_token: string
  token_type: 'bearer'
  user: Record<string, unknown>
  is_new_user?: boolean
}

type NavigationRequest = {
  url: string
}

type NavigationState = {
  url: string
  canGoBack: boolean
  loading?: boolean
}

type WebViewMessage = {
  nativeEvent: {
    data: string
  }
}

type WebViewError = {
  nativeEvent: {
    code?: number
    description?: string
    statusCode?: number
  }
}

GoogleSignin.configure({
  webClientId: GOOGLE_WEB_CLIENT_ID,
})

const GOOGLE_SIGN_IN_DEVELOPER_ERROR_CODE = '10'
const GOOGLE_SIGN_IN_ANDROID_PACKAGE = 'ru.morius.app'
const GOOGLE_SIGN_IN_ANDROID_SHA1 = '5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25'
const GOOGLE_SIGN_IN_ANDROID_CONFIG_ERROR_MESSAGE =
  `Google Sign-In is not configured for this Android APK. ` +
  `Create or update an Android OAuth client for package ${GOOGLE_SIGN_IN_ANDROID_PACKAGE} ` +
  `with SHA-1 ${GOOGLE_SIGN_IN_ANDROID_SHA1}.`

function getNativeGoogleSignInErrorMessage(error: unknown): string {
  if (isErrorWithCode(error)) {
    const message = String(error.message || '')
    if (error.code === GOOGLE_SIGN_IN_DEVELOPER_ERROR_CODE || /DEVELOPER_ERROR/i.test(message)) {
      return GOOGLE_SIGN_IN_ANDROID_CONFIG_ERROR_MESSAGE
    }
    return message || 'Google sign-in failed'
  }

  return error instanceof Error ? error.message : 'Google sign-in failed'
}

async function readResponseError(response: Response, fallbackMessage: string): Promise<Error> {
  try {
    const payload = (await response.json()) as { detail?: unknown }
    if (typeof payload.detail === 'string' && payload.detail.trim()) {
      return new Error(payload.detail)
    }
  } catch {
    // Keep fallback message.
  }

  return new Error(`${fallbackMessage} (HTTP ${response.status})`)
}

async function loginWithNativeGoogleToken(payload: {
  idToken?: string | null
  accessToken?: string | null
}): Promise<AuthResponse> {
  const response = await fetch(MORIUS_GOOGLE_AUTH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      id_token: payload.idToken || undefined,
      access_token: payload.accessToken || undefined,
    }),
  })

  if (!response.ok) {
    throw await readResponseError(response, 'Google sign-in failed')
  }

  return (await response.json()) as AuthResponse
}

function buildInjectAuthSessionScript(payload: AuthResponse): string {
  const userJson = JSON.stringify(payload.user)
  const dashboardUrl = `${MORIUS_SITE_ORIGIN}/dashboard`

  return `
    (function () {
      try {
        window.localStorage.setItem('morius.auth.token', ${JSON.stringify(payload.access_token)});
        window.localStorage.setItem('morius.auth.user', ${JSON.stringify(userJson)});
      } catch (error) {}
      window.location.replace(${JSON.stringify(dashboardUrl)});
      true;
    })();
  `
}

function buildNativeGoogleCompleteScript(): string {
  return `
    (function () {
      window.__MORIUS_ANDROID_GOOGLE_PENDING__ = false;
      true;
    })();
  `
}

function buildInjectedBeforeContentLoaded(): string {
  return `
    (function () {
      var siteOrigin = ${JSON.stringify(MORIUS_SITE_ORIGIN)};
      var entryUrl = ${JSON.stringify(MORIUS_ENTRY_URL)};
      if (window.location.origin === siteOrigin && (window.location.pathname === '/' || window.location.pathname === '')) {
        window.location.replace(entryUrl + window.location.search + window.location.hash);
      }
      true;
    })();
  `
}

function buildInjectedRuntimeBridge(): string {
  return `
    (function () {
      if (!window.__MORIUS_ANDROID_BRIDGE__) {
        window.__MORIUS_ANDROID_BRIDGE__ = true;

        var viewport = document.querySelector('meta[name="viewport"]');
        if (!viewport) {
          viewport = document.createElement('meta');
          viewport.setAttribute('name', 'viewport');
          document.head.appendChild(viewport);
        }
        viewport.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover');

        try {
          window.localStorage.setItem('morius.native.platform', 'android');
        } catch (error) {}

        var lastRightPanelClosePath = '';

        function postRoute() {
          try {
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'route',
              href: window.location.href,
              pathname: window.location.pathname
            }));
          } catch (error) {}
        }

        function postGoogleSignInRequest() {
          try {
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'googleSignIn'
            }));
          } catch (error) {
            window.__MORIUS_ANDROID_GOOGLE_PENDING__ = false;
          }
        }

        function isAuthGoogleButton(button) {
          if (!button || window.location.pathname.replace(/\\/+$/, '') !== '/auth') {
            return false;
          }
          var label = (button.innerText || button.textContent || '').replace(/\\s+/g, ' ').trim();
          return /google/i.test(label);
        }

        function handleDocumentClick(event) {
          var target = event.target;
          var button = target && typeof target.closest === 'function' ? target.closest('button') : null;
          if (!isAuthGoogleButton(button)) {
            return;
          }

          event.preventDefault();
          event.stopPropagation();
          if (typeof event.stopImmediatePropagation === 'function') {
            event.stopImmediatePropagation();
          }

          if (window.__MORIUS_ANDROID_GOOGLE_PENDING__) {
            return;
          }

          window.__MORIUS_ANDROID_GOOGLE_PENDING__ = true;
          postGoogleSignInRequest();
        }

        function isStoryGamePath(pathname) {
          return /^\\/home(?:\\/\\d+)?\\/?$/.test(pathname);
        }

        function isRightPanelOpen(toggle) {
          var icon = toggle ? toggle.querySelector('img') : null;
          if (!icon) {
            return false;
          }
          var transform = window.getComputedStyle(icon).transform;
          return !transform || transform === 'none';
        }

        function scheduleStoryRightPanelClose() {
          if (!isStoryGamePath(window.location.pathname)) {
            lastRightPanelClosePath = '';
            return;
          }

          var pathKey = window.location.pathname + window.location.search;
          if (lastRightPanelClosePath === pathKey) {
            return;
          }
          lastRightPanelClosePath = pathKey;

          var attempts = 0;
          function closeWhenReady() {
            attempts += 1;
            var toggle = document.querySelector('[data-tour-id="header-right-panel-toggle"]');
            if (toggle && isRightPanelOpen(toggle)) {
              toggle.click();
              return;
            }
            if (!toggle && attempts < 36) {
              window.setTimeout(closeWhenReady, 100);
            }
          }

          window.setTimeout(closeWhenReady, 240);
        }

        function handleRouteChanged() {
          postRoute();
          scheduleStoryRightPanelClose();
        }

        var pushState = window.history.pushState;
        var replaceState = window.history.replaceState;

        window.history.pushState = function () {
          var result = pushState.apply(this, arguments);
          window.setTimeout(handleRouteChanged, 0);
          return result;
        };

        window.history.replaceState = function () {
          var result = replaceState.apply(this, arguments);
          window.setTimeout(handleRouteChanged, 0);
          return result;
        };

        document.addEventListener('click', handleDocumentClick, true);
        window.addEventListener('popstate', handleRouteChanged);
        window.addEventListener('hashchange', handleRouteChanged);
        handleRouteChanged();
      }
      true;
    })();
  `
}

function isRouteMessage(value: unknown): value is NativeRouteMessage {
  if (!value || typeof value !== 'object') {
    return false
  }
  const candidate = value as Partial<NativeRouteMessage>
  return candidate.type === 'route' && typeof candidate.href === 'string'
}

function isGoogleSignInMessage(value: unknown): value is NativeGoogleSignInMessage {
  if (!value || typeof value !== 'object') {
    return false
  }
  const candidate = value as Partial<NativeBridgeMessage>
  return candidate.type === 'googleSignIn'
}

function OfflineState(props: {
  description: string
  onReload: () => void
}) {
  return (
    <SafeAreaView style={styles.fallback}>
      <Image source={require('./assets/icon.png')} style={styles.fallbackIcon} resizeMode="contain" />
      <Text style={styles.fallbackTitle}>MoRius</Text>
      <Text style={styles.fallbackText}>{props.description}</Text>
      <Pressable onPress={props.onReload} style={({ pressed }) => [styles.reloadButton, pressed && styles.reloadButtonPressed]}>
        <Text style={styles.reloadButtonText}>Обновить</Text>
      </Pressable>
    </SafeAreaView>
  )
}

function LoadingState() {
  return (
    <View style={styles.loading}>
      <ActivityIndicator color="#D9D9D9" size="large" />
    </View>
  )
}

function AppShell() {
  const webViewRef = useRef<ElementRef<typeof WebView>>(null)
  const isGoogleSignInInProgressRef = useRef(false)
  const [sourceUrl, setSourceUrl] = useState(MORIUS_ENTRY_URL)
  const [reloadKey, setReloadKey] = useState(0)
  const [canGoBack, setCanGoBack] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const injectedBeforeContentLoaded = useMemo(buildInjectedBeforeContentLoaded, [])
  const injectedJavaScript = useMemo(buildInjectedRuntimeBridge, [])

  const redirectToEntry = useCallback((url: string) => {
    const nextUrl = buildMoriusEntryUrlFrom(url)
    setLoadError(null)
    setSourceUrl(nextUrl)
    setReloadKey((current) => current + 1)
  }, [])

  const reload = useCallback(() => {
    setLoadError(null)
    setSourceUrl((currentUrl) => (isMoriusRootUrl(currentUrl) ? MORIUS_ENTRY_URL : currentUrl))
    setReloadKey((current) => current + 1)
  }, [])

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!canGoBack || !webViewRef.current) {
        return false
      }
      webViewRef.current.goBack()
      return true
    })

    return () => subscription.remove()
  }, [canGoBack])

  const handleShouldStartLoad = useCallback((request: NavigationRequest) => {
    const requestedUrl = request.url
    if (!isHttpUrl(requestedUrl)) {
      Linking.openURL(requestedUrl).catch(() => undefined)
      return false
    }
    if (isMoriusRootUrl(requestedUrl)) {
      redirectToEntry(requestedUrl)
      return false
    }
    return true
  }, [redirectToEntry])

  const handleNavigationStateChange = useCallback((navigationState: NavigationState) => {
    setCanGoBack(navigationState.canGoBack)
    if (isMoriusRootUrl(navigationState.url)) {
      redirectToEntry(navigationState.url)
    }
  }, [redirectToEntry])

  const completeNativeGoogleSignIn = useCallback(() => {
    webViewRef.current?.injectJavaScript(buildNativeGoogleCompleteScript())
    isGoogleSignInInProgressRef.current = false
  }, [])

  const handleNativeGoogleSignIn = useCallback(async () => {
    if (isGoogleSignInInProgressRef.current) {
      return
    }

    isGoogleSignInInProgressRef.current = true
    try {
      const hasPlayServices = await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true })
      if (!hasPlayServices) {
        throw new Error('Google Play Services are unavailable')
      }
      const signInResponse = await GoogleSignin.signIn()
      if (!isSuccessResponse(signInResponse)) {
        completeNativeGoogleSignIn()
        return
      }

      let idToken = signInResponse.data.idToken
      let accessToken: string | null = null
      try {
        const tokens = await GoogleSignin.getTokens()
        idToken = idToken || tokens.idToken
        accessToken = tokens.accessToken
      } catch {
        // The ID token from signIn() is enough for the backend when getTokens() is unavailable.
      }

      if (!idToken && !accessToken) {
        throw new Error('Google did not return an auth token')
      }

      const authResult = await loginWithNativeGoogleToken({ idToken, accessToken })
      webViewRef.current?.injectJavaScript(buildInjectAuthSessionScript(authResult))
      isGoogleSignInInProgressRef.current = false
    } catch (error) {
      completeNativeGoogleSignIn()
      Alert.alert('MoRius', getNativeGoogleSignInErrorMessage(error))
    }
  }, [completeNativeGoogleSignIn])

  const handleMessage = useCallback((event: WebViewMessage) => {
    try {
      const payload = JSON.parse(event.nativeEvent.data) as unknown
      if (isGoogleSignInMessage(payload)) {
        void handleNativeGoogleSignIn()
        return
      }
      if (isRouteMessage(payload) && isMoriusRootUrl(payload.href)) {
        redirectToEntry(payload.href)
      }
    } catch {
      // Ignore messages that are not emitted by the MoRius route bridge.
    }
  }, [handleNativeGoogleSignIn, redirectToEntry])

  const handleError = useCallback((event: WebViewError) => {
    const detail = event.nativeEvent.description?.trim()
    setLoadError(detail || 'Не удалось открыть приложение. Проверьте интернет и сервер MoRius.')
  }, [])

  const handleHttpError = useCallback((event: WebViewError) => {
    const statusCode = event.nativeEvent.statusCode ?? 0
    if (statusCode >= 500) {
      setLoadError(`Сервер MoRius временно недоступен. Код ответа: ${statusCode}.`)
    }
  }, [])

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <StatusBar style="light" />
      {loadError ? (
        <OfflineState description={loadError} onReload={reload} />
      ) : (
        <WebView
          key={reloadKey}
          ref={webViewRef}
          source={{ uri: sourceUrl }}
          style={styles.webView}
          containerStyle={styles.webViewContainer}
          originWhitelist={['http://*', 'https://*']}
          javaScriptEnabled
          domStorageEnabled
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          allowsBackForwardNavigationGestures
          allowsFullscreenVideo
          setSupportMultipleWindows={false}
          startInLoadingState
          renderLoading={LoadingState}
          injectedJavaScriptBeforeContentLoaded={injectedBeforeContentLoaded}
          injectedJavaScript={injectedJavaScript}
          onShouldStartLoadWithRequest={handleShouldStartLoad}
          onNavigationStateChange={handleNavigationStateChange}
          onMessage={handleMessage}
          onLoadStart={() => setLoadError(null)}
          onError={handleError}
          onHttpError={handleHttpError}
        />
      )}
    </SafeAreaView>
  )
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppShell />
    </SafeAreaProvider>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0B0B0B',
  },
  webViewContainer: {
    flex: 1,
    backgroundColor: '#0B0B0B',
  },
  webView: {
    flex: 1,
    backgroundColor: '#0B0B0B',
  },
  loading: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0B0B0B',
  },
  fallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    backgroundColor: '#0B0B0B',
  },
  fallbackIcon: {
    width: 84,
    height: 84,
    marginBottom: 18,
  },
  fallbackTitle: {
    color: '#F3F3F3',
    fontSize: 26,
    fontWeight: '800',
    marginBottom: 10,
    textAlign: 'center',
  },
  fallbackText: {
    color: '#B8B8B8',
    fontSize: 15,
    lineHeight: 21,
    marginBottom: 24,
    textAlign: 'center',
  },
  reloadButton: {
    minWidth: 148,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D9D9D9',
    backgroundColor: '#171717',
    paddingHorizontal: 18,
  },
  reloadButtonPressed: {
    backgroundColor: '#242424',
  },
  reloadButtonText: {
    color: '#F3F3F3',
    fontSize: 16,
    fontWeight: '700',
  },
})

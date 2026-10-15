import React, { useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';
import { router, Stack, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { AuthProvider, useAuth } from '@/state/auth';
import { AppStoreProvider, useAppStore } from '@/state/app-store';
import { DialogProvider } from '@/components/Dialog';
import ConsentGate from '@/components/ConsentGate';
import { loadThemePreference } from '@/state/theme';
import { useColors } from '@/hooks/useColors';

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

/** Route guard: no business data is reachable before sign-in and business setup. */
function useAuthGuard() {
  const auth = useAuth();
  const store = useAppStore();
  const segments = useSegments();
  const first = segments[0] as string | undefined;
  /** The sign-in screen ("/" or "/sign-in"); "/" alone is ambiguous with the Dashboard tab. */
  const onSignIn = first === undefined || first === 'index' || first === 'sign-in';
  useEffect(() => {
    if (auth.isLoading || !store.isHydrated) return;
    const signedIn = auth.signedIn;
    if (!signedIn && !onSignIn) router.replace('/sign-in');
    // Setup only once the server confirmed there is no business (not while it is loading).
    else if (signedIn && !store.business && store.accountLoaded && !onSignIn && first !== 'setup') router.replace('/setup');
  }, [auth.isLoading, auth.signedIn, store.isHydrated, store.business, store.accountLoaded, first, onSignIn]);
}

function RootLayoutNav() {
  const colors = useColors();
  useAuthGuard();
  return (
    <>
      <StatusBar style={colors.isDark ? 'light' : 'dark'} />
      <ConsentGate>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background }, animation: 'slide_from_right' }}>
        <Stack.Screen name="index" options={{ animation: 'fade' }} />
        <Stack.Screen name="sign-in" options={{ animation: 'fade' }} />
        <Stack.Screen name="setup" options={{ animation: 'fade' }} />
        <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
        <Stack.Screen name="invoice/new" options={{ presentation: 'modal' }} />
        <Stack.Screen name="invoice/import" options={{ presentation: 'modal' }} />
        <Stack.Screen name="invoice/[id]" />
        <Stack.Screen name="ewb/review/[invoiceId]" />
        <Stack.Screen name="ewb/[id]" />
        <Stack.Screen name="ewb/consolidate" />
        <Stack.Screen name="ewb/bulk" />
        <Stack.Screen name="account" />
        <Stack.Screen name="bank-details" />
        <Stack.Screen name="wallet" />
        <Stack.Screen name="billing" />
        <Stack.Screen name="ewb-login" />
        <Stack.Screen name="subscription" />
        <Stack.Screen name="saved/[kind]" />
        <Stack.Screen name="help" />
      </Stack>
      </ConsentGate>
    </>
  );
}

export default function RootLayout() {
  const [themeReady, setThemeReady] = useState(false);
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    void loadThemePreference().finally(() => setThemeReady(true));
  }, []);

  useEffect(() => {
    if ((fontsLoaded || fontError) && themeReady) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError, themeReady]);

  if ((!fontsLoaded && !fontError) || !themeReady) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <KeyboardProvider>
              <AuthProvider>
                <AppStoreProvider>
                  <DialogProvider>
                    <RootLayoutNav />
                  </DialogProvider>
                </AppStoreProvider>
              </AuthProvider>
            </KeyboardProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

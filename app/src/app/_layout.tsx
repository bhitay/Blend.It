import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { I18nManager, Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { colors, Loading } from '@/components/ui';
import { SessionProvider, useSession } from '@/lib/session';
import { isConfigured } from '@/lib/supabase';
import NotConfigured from '@/components/NotConfigured';

// Hebrew UI: lay everything out right-to-left. Native builds also force this via the
// expo-localization plugin (app.json); in Expo Go it applies from the second launch.
if (Platform.OS === 'web') {
  document.documentElement.dir = 'rtl';
  document.documentElement.lang = 'he';
} else if (!I18nManager.isRTL) {
  I18nManager.allowRTL(true);
  I18nManager.forceRTL(true);
}

function RootNavigator() {
  const { loading, session, household } = useSession();
  if (!isConfigured) return <NotConfigured />;
  if (loading) return <Loading />;

  const signedIn = Boolean(session);
  const ready = signedIn && Boolean(household);

  return (
    <Stack
      screenOptions={{
        headerTitleAlign: 'center',
        headerStyle: { backgroundColor: colors.bg },
        headerShadowVisible: false,
        headerBackButtonDisplayMode: 'minimal',
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && !household}>
        <Stack.Screen name="onboarding" options={{ title: 'משק הבית שלכם' }} />
      </Stack.Protected>
      <Stack.Protected guard={ready}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="account/new" options={{ title: 'חשבון חדש', presentation: 'modal' }} />
        <Stack.Screen name="account/[id]" options={{ title: '' }} />
        <Stack.Screen name="account/edit" options={{ title: 'עריכת חשבון', presentation: 'modal' }} />
        <Stack.Screen name="group/[id]" options={{ title: '' }} />
        <Stack.Screen name="category" options={{ title: 'סיווג', presentation: 'modal' }} />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <StatusBar style="dark" />
        <RootNavigator />
      </SessionProvider>
    </SafeAreaProvider>
  );
}

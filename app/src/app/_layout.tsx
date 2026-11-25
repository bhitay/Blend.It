import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { I18nManager, Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Button, Card, colors, Loading, Screen, Text, styles } from '@/components/ui';
import { PrivacyToggle } from '@/components/PrivateText';
import { PrivacyProvider } from '@/lib/privacy';
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
  const { loading, session, household, mfaRequired, loadError, refreshHousehold } = useSession();
  if (!isConfigured) return <NotConfigured />;
  if (loading) return <Loading />;
  if (session && !mfaRequired && !household && loadError) {
    return <LoadFailed message={loadError} onRetry={refreshHousehold} />;
  }

  const signedIn = Boolean(session);
  const verified = signedIn && !mfaRequired;
  const ready = verified && Boolean(household);

  return (
    <Stack
      screenOptions={{
        headerTitleAlign: 'center',
        headerStyle: { backgroundColor: colors.bg },
        headerShadowVisible: false,
        headerBackButtonDisplayMode: 'minimal',
        contentStyle: { backgroundColor: colors.bg },
        headerRight: () => <PrivacyToggle />,
      }}
    >
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && mfaRequired}>
        <Stack.Screen name="mfa-verify" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={verified && !household}>
        <Stack.Screen name="onboarding" options={{ title: 'משק הבית שלכם', headerRight: () => null }} />
      </Stack.Protected>
      <Stack.Protected guard={ready}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="account/new" options={{ title: 'חשבון חדש', presentation: 'modal' }} />
        <Stack.Screen name="account/[id]" options={{ title: '' }} />
        <Stack.Screen name="account/edit" options={{ title: 'עריכת חשבון', presentation: 'modal' }} />
        <Stack.Screen name="group/[id]" options={{ title: '' }} />
        <Stack.Screen name="mfa-setup" options={{ title: 'אימות דו-שלבי', presentation: 'modal' }} />
        <Stack.Screen name="category" options={{ title: 'סיווג', presentation: 'modal' }} />
      </Stack.Protected>
    </Stack>
  );
}

function LoadFailed({ message, onRetry }: { message: string; onRetry: () => Promise<void> }) {
  return (
    <Screen edges={['top', 'bottom']}>
      <Card style={{ marginTop: 48 }}>
        <Text style={{ fontWeight: '700', fontSize: 18 }}>לא הצלחנו לטעון את הנתונים</Text>
        <Text style={styles.muted}>בדקו את החיבור לאינטרנט ונסו שוב. ({message})</Text>
        <Button title="לנסות שוב" onPress={() => onRetry()} />
      </Card>
    </Screen>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <PrivacyProvider>
          <StatusBar style="dark" />
          <RootNavigator />
        </PrivacyProvider>
      </SessionProvider>
    </SafeAreaProvider>
  );
}

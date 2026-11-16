import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import type { ColorValue } from 'react-native';
import { colors } from '@/components/ui';

type IconName = keyof typeof Ionicons.glyphMap;

function icon(name: IconName) {
  return ({ color, size }: { color: ColorValue; size: number }) => <Ionicons name={name} color={color as string} size={size} />;
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        headerTitleAlign: 'center',
        headerStyle: { backgroundColor: colors.bg },
        headerShadowVisible: false,
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'סקירה', tabBarIcon: icon('pie-chart-outline') }} />
      <Tabs.Screen name="accounts" options={{ title: 'חשבונות', tabBarIcon: icon('wallet-outline') }} />
      <Tabs.Screen name="settings" options={{ title: 'הגדרות', tabBarIcon: icon('settings-outline') }} />
    </Tabs>
  );
}

import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

const url = projectOrigin(process.env.EXPO_PUBLIC_SUPABASE_URL);
const key = process.env.EXPO_PUBLIC_SUPABASE_KEY?.trim();

/**
 * Supabase wants the bare project URL (https://xxxx.supabase.co). The dashboard sometimes shows
 * it with a path such as /rest/v1/, which breaks auth with "Invalid path specified in request URL".
 */
function projectOrigin(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  try {
    return new URL(trimmed).origin;
  } catch {
    return trimmed;
  }
}

/** False until app/.env is filled in (see app/.env.example). */
export const isConfigured = Boolean(url && key);

export const supabase = createClient(url || 'http://localhost:54321', key || 'not-configured', {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Only refresh the session while the app is in the foreground.
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}

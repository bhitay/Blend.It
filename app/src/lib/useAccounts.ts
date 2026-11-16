import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { fetchAccounts, type Account } from './api';
import { useHousehold } from './session';

/** Household accounts, reloaded whenever the screen comes into focus. */
export function useAccounts() {
  const { household } = useHousehold();
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setAccounts(await fetchAccounts(household.id));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [household.id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  return { accounts, error, refreshing, refresh };
}

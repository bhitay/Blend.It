import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Platform, View } from 'react-native';
import { decideJoinRequest, fetchJoinRequests, type JoinRequest } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useHousehold } from '@/lib/session';
import { Button, Card, colors, ErrorText, Text, styles } from './ui';

function confirm(title: string, message: string): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(Boolean(globalThis.confirm?.(`${title}\n\n${message}`)));
  return new Promise((resolve) =>
    Alert.alert(title, message, [
      { text: 'ביטול', style: 'cancel', onPress: () => resolve(false) },
      { text: 'אישור', onPress: () => resolve(true) },
    ]),
  );
}

/**
 * Owner only: people who entered the invite code and are waiting for approval.
 * Renders nothing for other members or when there are no requests.
 */
export default function JoinRequests() {
  const { household, members, userId, refreshHousehold } = useHousehold();
  const isOwner = members.find((m) => m.user_id === userId)?.role === 'owner';
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isOwner) return;
    setRequests(await fetchJoinRequests(household.id).catch(() => []));
  }, [isOwner, household.id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );
  // Reload when membership changes (e.g. a request was approved from the other copy of this card).
  useEffect(() => {
    load();
  }, [load, members.length]);

  // While there is room in the household a request can arrive at any time: check every few seconds.
  const hasRoom = members.length < household.max_members;
  useEffect(() => {
    if (!isOwner || !hasRoom) return;
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [isOwner, hasRoom, load]);

  if (!isOwner || requests.length === 0) return null;

  async function decide(r: JoinRequest, approve: boolean) {
    const ok = await confirm(
      approve ? `לאשר את ${r.display_name}?` : `לדחות את ${r.display_name}?`,
      approve
        ? `${r.email ?? ''}\n\nאחרי האישור יהיו לה/לו גישה מלאה לכל הנתונים של משק הבית. אשרו רק אם אתם מכירים את האימייל.`
        : `${r.email ?? ''}\n\nהבקשה תיסגר ולא תהיה גישה לנתונים.`,
    );
    if (!ok) return;
    setBusy(r.id);
    setError(null);
    try {
      await decideJoinRequest(r.id, approve);
      await Promise.all([load(), approve ? refreshHousehold() : Promise.resolve()]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card style={{ borderColor: '#FEDF89', backgroundColor: '#FFFAEB' }}>
      <View style={styles.row}>
        <Ionicons name="person-add-outline" size={20} color={colors.warning} />
        <Text style={{ flex: 1, fontWeight: '700', color: colors.warning }}>
          {requests.length === 1 ? 'בקשת הצטרפות ממתינה' : `${requests.length} בקשות הצטרפות ממתינות`}
        </Text>
      </View>
      {requests.map((r) => (
        <View key={r.id} style={{ gap: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#FEDF89' }}>
          <View>
            <Text style={{ fontWeight: '600' }}>{r.display_name}</Text>
            <Text style={[styles.muted, { fontSize: 13 }]}>
              {r.email} · {formatDate(r.created_at)}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Button title="אישור" onPress={() => decide(r, true)} loading={busy === r.id} />
            </View>
            <View style={{ flex: 1 }}>
              <Button title="דחייה" variant="danger" onPress={() => decide(r, false)} disabled={busy === r.id} />
            </View>
          </View>
        </View>
      ))}
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}

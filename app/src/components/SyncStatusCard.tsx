import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { fetchSyncStatus, type SyncStatus } from '@/lib/api';
import { useHousehold } from '@/lib/session';
import { Card, colors, SectionTitle, Text, styles } from './ui';

const STALE_HOURS = 48;

function ago(iso: string | null): string {
  if (!iso) return 'אף פעם';
  const hours = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (hours < 1) return 'לפני פחות משעה';
  if (hours < 24) return `לפני ${Math.floor(hours)} שעות`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'אתמול' : `לפני ${days} ימים`;
}

/** Status of the home sync, per bank / card. Renders nothing until the first sync ran. */
export default function SyncStatusCard() {
  const { household } = useHousehold();
  const [rows, setRows] = useState<SyncStatus[]>([]);

  useFocusEffect(
    useCallback(() => {
      // Before migration 0002 the view doesn't exist; the card just stays hidden.
      fetchSyncStatus(household.id).then(setRows, () => setRows([]));
    }, [household.id]),
  );

  if (rows.length === 0) return null;

  return (
    <>
      <SectionTitle>סנכרון אוטומטי</SectionTitle>
      <Card style={{ gap: 0, paddingVertical: 4 }}>
        {rows.map((r, i) => {
          const stale = !r.last_success_at || Date.now() - new Date(r.last_success_at).getTime() > STALE_HOURS * 3_600_000;
          const failed = r.status === 'error';
          const color = failed ? colors.negative : stale ? colors.warning : colors.positive;
          return (
            <View
              key={`${r.institution}:${r.label}`}
              style={[{ paddingVertical: 10, gap: 2 }, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}
            >
              <View style={styles.row}>
                <Text style={{ fontWeight: '600', flex: 1 }}>{r.label ?? r.institution}</Text>
                <Text style={{ color, fontSize: 14 }}>
                  {r.status === 'running' ? 'מסתנכרן…' : `עודכן ${ago(r.last_success_at)}`}
                </Text>
              </View>
              {failed && r.error_message ? (
                <Text style={{ color: colors.negative, fontSize: 13 }}>{r.error_message}</Text>
              ) : null}
            </View>
          );
        })}
      </Card>
    </>
  );
}

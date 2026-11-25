import { PrivateText } from '@/components/PrivateText';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Platform, Pressable, RefreshControl, SectionList, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, ErrorText, Loading, Text, styles } from '@/components/ui';
import type { Account } from '@/lib/api';
import { GROUPS, institutionLabel, KINDS } from '@/lib/accountKinds';
import { formatDate, formatMoney } from '@/lib/format';
import { useHousehold } from '@/lib/session';
import { useAccounts } from '@/lib/useAccounts';

export default function Accounts() {
  const { accounts, error, refreshing, refresh } = useAccounts();
  const { members, userId } = useHousehold();
  if (!accounts) return error ? <ErrorText>{error}</ErrorText> : <Loading />;

  const ownerLabel = (a: Account) => {
    if (!a.owner_user_id) return 'משותף';
    if (a.owner_user_id === userId) return 'שלי';
    return members.find((m) => m.user_id === a.owner_user_id)?.display_name ?? '';
  };

  const sections = GROUPS.map((g) => ({
    title: g.label,
    data: accounts.filter((a) => KINDS[a.kind].group === g.id),
  })).filter((s) => s.data.length > 0);

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <SectionList
        sections={sections}
        keyExtractor={(a) => a.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 96 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
        stickySectionHeadersEnabled={false}
        ListEmptyComponent={<Text style={[styles.muted, { textAlign: 'center', marginTop: 48 }]}>עדיין אין חשבונות</Text>}
        renderSectionHeader={({ section }) => (
          <Text style={[styles.sectionTitle, { marginTop: 16, marginBottom: 8 }]}>{section.title}</Text>
        )}
        renderItem={({ item: a, index, section }) => (
          <Pressable
            onPress={() => router.push({ pathname: '/account/[id]', params: { id: a.id } })}
            style={({ pressed }) => [
              styles.row,
              {
                backgroundColor: pressed ? colors.primarySoft : colors.card,
                padding: 14,
                borderTopWidth: index > 0 ? 1 : 0,
                borderColor: colors.border,
                borderTopLeftRadius: index === 0 ? 14 : 0,
                borderTopRightRadius: index === 0 ? 14 : 0,
                borderBottomLeftRadius: index === section.data.length - 1 ? 14 : 0,
                borderBottomRightRadius: index === section.data.length - 1 ? 14 : 0,
              },
            ]}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ fontWeight: '600' }}>{a.name}</Text>
              <Text style={styles.muted}>
                {[KINDS[a.kind].label, institutionLabel(a.institution), ownerLabel(a)].filter(Boolean).join(' · ')}
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 2 }}>
              <PrivateText style={{ fontWeight: '700', color: a.signed_balance < 0 ? colors.negative : colors.text }}>
                {a.balance == null ? '—' : formatMoney(a.signed_balance, a.currency)}
              </PrivateText>
              <Text style={[styles.muted, { fontSize: 12 }]}>{formatDate(a.balance_as_of)}</Text>
            </View>
          </Pressable>
        )}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="הוספת חשבון"
        onPress={() => router.push('/account/new')}
        style={({ pressed }) => ({
          position: 'absolute',
          bottom: 24,
          // Bottom-left in RTL. RN-web doesn't flip logical insets, so use `left` there.
          ...(Platform.OS === 'web' ? { left: 24 } : { end: 24 }),
          width: 56,
          height: 56,
          borderRadius: 28,
          backgroundColor: colors.primary,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.85 : 1,
          shadowColor: '#000',
          shadowOpacity: 0.15,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 4 },
          elevation: 4,
        })}
      >
        <Ionicons name="add" size={28} color="#fff" />
      </Pressable>
    </SafeAreaView>
  );
}

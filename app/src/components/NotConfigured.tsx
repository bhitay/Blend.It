import { Card, Screen, Text, styles } from './ui';

/** Shown when app/.env is missing the Supabase settings. */
export default function NotConfigured() {
  return (
    <Screen edges={['top', 'bottom']}>
      <Card>
        <Text style={{ fontSize: 20, fontWeight: '700' }}>צריך לחבר את Supabase</Text>
        <Text style={styles.muted}>
          העתיקו את app/.env.example לקובץ app/.env, מלאו את כתובת הפרויקט והמפתח (Publishable key) מתוך Supabase, והפעילו
          את האפליקציה מחדש.
        </Text>
      </Card>
    </Screen>
  );
}

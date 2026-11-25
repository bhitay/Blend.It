import Ionicons from '@expo/vector-icons/Ionicons';
import { Children, type ReactNode } from 'react';
import { Pressable, Text as RNText, type TextProps } from 'react-native';
import { placeholderFor, splitMoney } from '@/lib/moneyText';
import { usePrivacy } from '@/lib/privacy';
import { colors, Text } from './ui';

/**
 * Text that may contain amounts. In privacy mode every amount in it becomes "*****"
 * (the real number is not in the page at all); the rest of the text stays readable.
 */
export function PrivateText({ children, accessibilityLabel, ...rest }: TextProps & { children?: ReactNode }) {
  const { hidden } = usePrivacy();
  const items = Children.toArray(children);
  const plain = items.every((c) => typeof c === 'string' || typeof c === 'number');
  if (!hidden || !plain) {
    return (
      <Text accessibilityLabel={accessibilityLabel} {...rest}>
        {children}
      </Text>
    );
  }
  const text = items.join('');
  const parts = splitMoney(text);
  if (!parts.some((p) => p.money)) return <Text {...rest}>{children}</Text>;
  return (
    <Text {...rest} accessibilityLabel={parts.map((p) => (p.money ? 'סכום מוסתר' : p.text)).join('')}>
      {parts.map((p, i) =>
        p.money ? (
          <RNText key={i} aria-hidden>
            {placeholderFor(p.text)}
          </RNText>
        ) : (
          p.text
        ),
      )}
    </Text>
  );
}

/** The eye button in the header: show / hide all amounts. */
export function PrivacyToggle() {
  const { hidden, toggle } = usePrivacy();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={hidden ? 'הצגת סכומים' : 'הסתרת סכומים'}
      onPress={toggle}
      hitSlop={12}
      style={{ paddingHorizontal: 16 }}
    >
      <Ionicons name={hidden ? 'eye-off-outline' : 'eye-outline'} size={22} color={colors.primary} />
    </Pressable>
  );
}

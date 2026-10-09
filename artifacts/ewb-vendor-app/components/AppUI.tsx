import React, { type ReactNode } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';

export function Page({ children, contentStyle }: { children: ReactNode; contentStyle?: ViewStyle }) {
  const colors = useColors();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={[
        styles.page,
        {
          paddingTop: Platform.OS === 'web' ? 67 : 20,
          paddingBottom: Platform.OS === 'web' ? 110 : 96,
        },
        contentStyle,
      ]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      contentInsetAdjustmentBehavior="automatic"
    >
      {children}
    </ScrollView>
  );
}

export function TextBlock({
  children,
  size = 15,
  color,
  weight = 'regular',
  style,
  numberOfLines,
}: {
  children: ReactNode;
  size?: number;
  color?: string;
  weight?: 'regular' | 'medium' | 'semibold' | 'bold';
  style?: object;
  numberOfLines?: number;
}) {
  const colors = useColors();
  return (
    <Text
      numberOfLines={numberOfLines}
      style={[
        { color: color ?? colors.foreground, fontSize: size, fontFamily: `Inter_${weight === 'regular' ? '400Regular' : weight === 'medium' ? '500Medium' : weight === 'semibold' ? '600SemiBold' : '700Bold'}` },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

export function Heading({ eyebrow, title, subtitle }: { eyebrow?: string; title: string; subtitle?: string }) {
  const colors = useColors();
  return (
    <View style={styles.heading}>
      {eyebrow ? <TextBlock size={11} weight="bold" color={colors.primary} style={styles.eyebrow}>{eyebrow.toUpperCase()}</TextBlock> : null}
      <TextBlock size={28} weight="bold" style={styles.title}>{title}</TextBlock>
      {subtitle ? <TextBlock color={colors.mutedForeground} style={styles.subtitle}>{subtitle}</TextBlock> : null}
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const colors = useColors();
  return <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }, style]}>{children}</View>;
}

export function SectionTitle({ title, action, onPress }: { title: string; action?: string; onPress?: () => void }) {
  const colors = useColors();
  return (
    <View style={styles.sectionTitle}>
      <TextBlock size={18} weight="semibold">{title}</TextBlock>
      {action ? <Pressable onPress={onPress} hitSlop={8}><TextBlock size={13} weight="semibold" color={colors.primary}>{action}</TextBlock></Pressable> : null}
    </View>
  );
}

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  autoCapitalize,
  multiline,
  secureTextEntry,
  error,
  editable = true,
  right,
  testID,
}: TextInputProps & {
  label: string;
  error?: string;
  right?: ReactNode;
}) {
  const colors = useColors();
  return (
    <View style={styles.fieldWrap}>
      <TextBlock size={13} weight="semibold" style={styles.fieldLabel}>{label}</TextBlock>
      <View style={[
        styles.inputShell,
        { backgroundColor: colors.card, borderColor: error ? colors.destructive : colors.input },
        multiline && styles.multilineShell,
      ]}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.mutedForeground}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          multiline={multiline}
          secureTextEntry={secureTextEntry}
          editable={editable}
          testID={testID}
          style={[
            styles.input,
            { color: colors.foreground },
            multiline && styles.multilineInput,
            !editable && { opacity: 0.6 },
          ]}
        />
        {right}
      </View>
      {error ? <TextBlock size={12} color={colors.destructive}>{error}</TextBlock> : null}
    </View>
  );
}

export function Button({
  title,
  onPress,
  secondary = false,
  disabled = false,
  loading = false,
  icon,
  testID,
}: {
  title: string;
  onPress: () => void;
  secondary?: boolean;
  disabled?: boolean;
  loading?: boolean;
  icon?: keyof typeof Feather.glyphMap;
  testID?: string;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      testID={testID}
      style={({ pressed }) => [
        styles.button,
        secondary
          ? { backgroundColor: colors.secondary, borderColor: colors.border }
          : { backgroundColor: colors.primary, borderColor: colors.primary },
        (disabled || loading) && styles.disabled,
        pressed && !disabled && { opacity: 0.82, transform: [{ scale: 0.99 }] },
      ]}
    >
      {loading ? <ActivityIndicator color={secondary ? colors.primary : colors.primaryForeground} /> : null}
      {!loading && icon ? <Feather name={icon} size={17} color={secondary ? colors.secondaryForeground : colors.primaryForeground} /> : null}
      <TextBlock size={15} weight="semibold" color={secondary ? colors.secondaryForeground : colors.primaryForeground}>{title}</TextBlock>
    </Pressable>
  );
}

export function IconButton({ icon, onPress, accessibilityLabel, color }: { icon: keyof typeof Feather.glyphMap; onPress: () => void; accessibilityLabel: string; color?: string }) {
  const colors = useColors();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel} hitSlop={8} style={({ pressed }) => [styles.iconButton, pressed && { opacity: 0.6 }]}>
      <Feather name={icon} size={19} color={color ?? colors.foreground} />
    </Pressable>
  );
}

export function StatusPill({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'green' | 'amber' | 'red' }) {
  const colors = useColors();
  const palette = {
    neutral: { bg: colors.muted, fg: colors.mutedForeground },
    green: { bg: '#e5f1e7', fg: '#27603b' },
    amber: { bg: '#f8efd9', fg: '#896318' },
    red: { bg: '#f7e7e4', fg: colors.destructive },
  }[tone];
  return <View style={[styles.pill, { backgroundColor: palette.bg }]}><TextBlock size={11} weight="semibold" color={palette.fg}>{label}</TextBlock></View>;
}

export function Notice({
  title,
  body,
  tone = 'info',
}: {
  title: string;
  body: string;
  tone?: 'info' | 'warning';
}) {
  const colors = useColors();
  const icon = tone === 'warning' ? 'alert-triangle' : 'info';
  return (
    <View style={[
      styles.notice,
      { backgroundColor: tone === 'warning' ? '#fff4e8' : colors.accent, borderColor: tone === 'warning' ? '#eed6b7' : colors.border },
    ]}>
      <Feather name={icon} size={17} color={tone === 'warning' ? '#986319' : colors.primary} />
      <View style={{ flex: 1, gap: 3 }}>
        <TextBlock size={13} weight="semibold">{title}</TextBlock>
        <TextBlock size={12} color={colors.mutedForeground} style={{ lineHeight: 17 }}>{body}</TextBlock>
      </View>
    </View>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  const colors = useColors();
  return (
    <View style={styles.empty}>
      <View style={[styles.emptyIcon, { backgroundColor: colors.accent }]}><Feather name={icon} size={23} color={colors.primary} /></View>
      <TextBlock size={17} weight="semibold">{title}</TextBlock>
      <TextBlock size={13} color={colors.mutedForeground} style={styles.emptyBody}>{body}</TextBlock>
      {action}
    </View>
  );
}

export function Divider() {
  const colors = useColors();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border }} />;
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: 20, gap: 20 },
  heading: { gap: 6, marginBottom: 1 },
  eyebrow: { letterSpacing: 1.2 },
  title: { letterSpacing: -0.7 },
  subtitle: { lineHeight: 21, marginTop: 1 },
  card: { borderWidth: 1, borderRadius: 20, padding: 17, gap: 14 },
  sectionTitle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
  fieldWrap: { gap: 7 },
  fieldLabel: { marginLeft: 1 },
  inputShell: { minHeight: 50, borderWidth: 1, borderRadius: 14, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14 },
  input: { flex: 1, paddingVertical: 12, fontSize: 15, fontFamily: 'Inter_400Regular' },
  multilineShell: { minHeight: 90, alignItems: 'stretch' },
  multilineInput: { minHeight: 72, textAlignVertical: 'top' },
  button: { height: 52, paddingHorizontal: 17, borderRadius: 15, borderWidth: 1, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 9 },
  disabled: { opacity: 0.47 },
  iconButton: { width: 42, height: 42, justifyContent: 'center', alignItems: 'center' },
  pill: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  notice: { flexDirection: 'row', gap: 11, alignItems: 'flex-start', borderRadius: 16, borderWidth: 1, padding: 13 },
  empty: { alignItems: 'center', paddingHorizontal: 18, paddingVertical: 34, gap: 10 },
  emptyIcon: { width: 54, height: 54, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  emptyBody: { textAlign: 'center', lineHeight: 19, maxWidth: 290 },
});

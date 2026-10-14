import React, { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { nearEnd } from '@/hooks/useLoadMore';
import { KeyboardAvoidingViewCompat, KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { paiseToInput, parseRupees } from '@/lib/domain';

type IconName = keyof typeof Feather.glyphMap;
export type Tone = 'neutral' | 'green' | 'amber' | 'red' | 'blue';

/** Scrollable tab page. Adds safe-area top padding and room for the tab bar. */
export function Page({ children, contentStyle, onRefresh, refreshing = false, tab = true, onEndReached }: { children: ReactNode; contentStyle?: ViewStyle; onRefresh?: () => void; refreshing?: boolean; tab?: boolean; onEndReached?: () => void }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAwareScrollViewCompat
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={[
        styles.page,
        { paddingTop: (Platform.OS === 'web' ? 24 : insets.top) + 12, paddingBottom: (tab ? 104 : 32) + (Platform.OS === 'web' ? 10 : insets.bottom) },
        contentStyle,
      ]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      onScroll={onEndReached ? (event) => { if (nearEnd(event.nativeEvent)) onEndReached(); } : undefined}
      scrollEventThrottle={onEndReached ? 120 : undefined}
      refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} /> : undefined}
    >
      {children}
    </KeyboardAwareScrollViewCompat>
  );
}

/** End of a paged list: a loader while the next page loads, otherwise a tap target for it. */
export function LoadMore({ remaining, loading, onPress, noun = 'more' }: { remaining: number; loading: boolean; onPress: () => void; noun?: string }) {
  const colors = useColors();
  if (remaining <= 0) return null;
  return (
    <Pressable onPress={onPress} disabled={loading} accessibilityRole="button" accessibilityLabel={loading ? 'Loading more' : `Load ${remaining} ${noun}`} testID="load-more" style={styles.loadMore}>
      {loading ? <ActivityIndicator size="small" color={colors.primary} /> : <Feather name="chevrons-down" size={16} color={colors.primary} />}
      <TextBlock size={13} weight="semibold" color={colors.primary}>{loading ? 'Loading more…' : `${remaining} ${noun} · scroll to load`}</TextBlock>
    </Pressable>
  );
}

/** Top bar for stacked/modal screens. */
export function ScreenHeader({ title, subtitle, right, onBack, back = true }: { title: string; subtitle?: string; right?: ReactNode; onBack?: () => void; back?: boolean }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.screenHeader, { paddingTop: (Platform.OS === 'web' ? 14 : insets.top) + 6, backgroundColor: colors.background, borderBottomColor: colors.border }]}>
      {back ? <IconButton icon="arrow-left" accessibilityLabel="Go back" onPress={onBack ?? (() => (router.canGoBack() ? router.back() : router.replace('/(tabs)')))} /> : null}
      <View style={{ flex: 1, gap: 2 }}>
        <TextBlock size={17} weight="semibold" numberOfLines={1}>{title}</TextBlock>
        {subtitle ? <TextBlock size={11} color={colors.mutedForeground} numberOfLines={1}>{subtitle}</TextBlock> : null}
      </View>
      {right}
    </View>
  );
}

export function TextBlock({
  children,
  size = 15,
  color,
  weight = 'regular',
  style,
  numberOfLines,
  selectable,
  accessibilityRole,
}: {
  children: ReactNode;
  size?: number;
  color?: string;
  weight?: 'regular' | 'medium' | 'semibold' | 'bold';
  style?: object;
  numberOfLines?: number;
  selectable?: boolean;
  accessibilityRole?: 'header' | 'text';
}) {
  const colors = useColors();
  return (
    <Text
      numberOfLines={numberOfLines}
      selectable={selectable}
      accessibilityRole={accessibilityRole}
      maxFontSizeMultiplier={1.6}
      style={[
        { color: color ?? colors.foreground, fontSize: size, fontFamily: `Inter_${weight === 'regular' ? '400Regular' : weight === 'medium' ? '500Medium' : weight === 'semibold' ? '600SemiBold' : '700Bold'}` },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

export function Heading({ eyebrow, title, subtitle, right }: { eyebrow?: string; title: string; subtitle?: string; right?: ReactNode }) {
  const colors = useColors();
  return (
    <View style={styles.headingRow}>
      <View style={[styles.heading, { flex: 1 }]}>
        {eyebrow ? <TextBlock size={11} weight="bold" color={colors.primary} style={styles.eyebrow}>{eyebrow.toUpperCase()}</TextBlock> : null}
        <TextBlock size={28} weight="bold" style={styles.title} accessibilityRole="header">{title}</TextBlock>
        {subtitle ? <TextBlock color={colors.mutedForeground} style={styles.subtitle}>{subtitle}</TextBlock> : null}
      </View>
      {right}
    </View>
  );
}

export function Card({ children, style, onPress, accessibilityLabel }: { children: ReactNode; style?: ViewStyle; onPress?: () => void; accessibilityLabel?: string }) {
  const colors = useColors();
  const base = [styles.card, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius + 2 }, style];
  if (!onPress) return <View style={base}>{children}</View>;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel} style={({ pressed }) => [...base, pressed && { opacity: 0.86, transform: [{ scale: 0.995 }] }]}>
      {children}
    </Pressable>
  );
}

export function SectionTitle({ title, action, onPress, count }: { title: string; action?: string; onPress?: () => void; count?: number }) {
  const colors = useColors();
  return (
    <View style={styles.sectionTitle}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <TextBlock size={18} weight="semibold" accessibilityRole="header">{title}</TextBlock>
        {count !== undefined ? <View style={[styles.count, { backgroundColor: colors.muted }]}><TextBlock size={11} weight="semibold" color={colors.mutedForeground}>{count}</TextBlock></View> : null}
      </View>
      {action ? <Pressable onPress={onPress} hitSlop={12} accessibilityRole="button"><TextBlock size={13} weight="semibold" color={colors.primary}>{action}</TextBlock></Pressable> : null}
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
  hint,
  editable = true,
  right,
  testID,
  maxLength,
  required,
  confidence,
  onBlur,
  autoComplete,
  textContentType,
  returnKeyType,
  onSubmitEditing,
}: TextInputProps & {
  label: string;
  error?: string;
  hint?: string;
  right?: ReactNode;
  required?: boolean;
  confidence?: 'high' | 'medium' | 'low';
}) {
  const colors = useColors();
  const [focused, setFocused] = useState(false);
  const [reveal, setReveal] = useState(false);
  const border = error ? colors.destructive : focused ? colors.primary : confidence === 'low' ? colors.warmAccent : colors.input;
  return (
    <View style={styles.fieldWrap}>
      <View style={styles.labelRow}>
        <TextBlock size={13} weight="semibold" style={styles.fieldLabel}>{label}{required ? <TextBlock size={13} weight="semibold" color={colors.destructive}> *</TextBlock> : null}</TextBlock>
        {confidence ? <ConfidenceTag level={confidence} /> : null}
      </View>
      <View style={[
        styles.inputShell,
        { backgroundColor: editable ? colors.card : colors.muted, borderColor: border, borderWidth: focused || error ? 1.5 : 1 },
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
          secureTextEntry={secureTextEntry && !reveal}
          editable={editable}
          maxLength={maxLength}
          autoComplete={autoComplete}
          textContentType={textContentType}
          returnKeyType={returnKeyType}
          onSubmitEditing={onSubmitEditing}
          onFocus={() => setFocused(true)}
          onBlur={(event) => { setFocused(false); onBlur?.(event); }}
          testID={testID}
          accessibilityLabel={label}
          accessibilityHint={error ?? hint}
          maxFontSizeMultiplier={1.5}
          style={[styles.input, { color: colors.foreground }, multiline && styles.multilineInput, !editable && { opacity: 0.75 }]}
        />
        {secureTextEntry ? (
          <Pressable onPress={() => setReveal((current) => !current)} hitSlop={10} accessibilityRole="button" accessibilityLabel={reveal ? 'Hide password' : 'Show password'} style={styles.reveal}>
            <Feather name={reveal ? 'eye-off' : 'eye'} size={18} color={colors.mutedForeground} />
          </Pressable>
        ) : null}
        {right}
      </View>
      {error ? (
        <View style={styles.errorRow}><Feather name="alert-circle" size={13} color={colors.dangerForeground} /><TextBlock size={12} color={colors.dangerForeground} style={{ flex: 1 }}>{error}</TextBlock></View>
      ) : hint ? <TextBlock size={11} color={colors.mutedForeground} style={{ lineHeight: 16 }}>{hint}</TextBlock> : null}
    </View>
  );
}

/** Rupee input that keeps the user's typing intact and commits paise on change. */
export function MoneyField({ label, paise, onChange, error, required, editable = true, hint, confidence }: { label: string; paise: number; onChange: (paise: number) => void; error?: string; required?: boolean; editable?: boolean; hint?: string; confidence?: 'high' | 'medium' | 'low' }) {
  const [text, setText] = useState(paiseToInput(paise));
  const last = useRef(paise);
  useEffect(() => {
    if (paise !== last.current) {
      last.current = paise;
      setText(paiseToInput(paise));
    }
  }, [paise]);
  return (
    <Field
      label={label}
      value={text}
      required={required}
      editable={editable}
      error={error}
      hint={hint}
      confidence={confidence}
      keyboardType="decimal-pad"
      placeholder="0.00"
      onChangeText={(value) => {
        const clean = value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1').replace(/(\.\d{0,2}).*/, '$1');
        setText(clean);
        const next = parseRupees(clean);
        last.current = next;
        onChange(next);
      }}
      onBlur={() => setText(paiseToInput(last.current))}
      right={<TextBlock size={14} weight="semibold" color={undefined}>₹</TextBlock>}
    />
  );
}

export function ConfidenceTag({ level }: { level: 'high' | 'medium' | 'low' }) {
  const colors = useColors();
  const meta = { high: { label: 'From PDF', bg: colors.successBackground, fg: colors.successForeground }, medium: { label: 'Please check', bg: colors.warningBackground, fg: colors.warningForeground }, low: { label: 'Uncertain', bg: colors.dangerBackground, fg: colors.dangerForeground } }[level];
  return <View style={[styles.tag, { backgroundColor: meta.bg }]}><TextBlock size={10} weight="semibold" color={meta.fg}>{meta.label}</TextBlock></View>;
}

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'outline';

export function Button({
  title,
  onPress,
  secondary = false,
  variant,
  disabled = false,
  loading = false,
  icon,
  testID,
  size = 'md',
  style,
  accessibilityHint,
}: {
  title: string;
  onPress: () => void;
  secondary?: boolean;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  icon?: IconName;
  testID?: string;
  size?: 'sm' | 'md';
  style?: ViewStyle;
  accessibilityHint?: string;
}) {
  const colors = useColors();
  const kind: ButtonVariant = variant ?? (secondary ? 'secondary' : 'primary');
  const palette = {
    primary: { bg: colors.primary, fg: colors.primaryForeground, border: colors.primary },
    secondary: { bg: colors.secondary, fg: colors.secondaryForeground, border: colors.secondary },
    danger: { bg: colors.dangerBackground, fg: colors.dangerForeground, border: colors.dangerBorder },
    ghost: { bg: 'transparent', fg: colors.primary, border: 'transparent' },
    outline: { bg: colors.card, fg: colors.foreground, border: colors.border },
  }[kind];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => [
        styles.button,
        size === 'sm' && styles.buttonSm,
        { backgroundColor: palette.bg, borderColor: palette.border },
        (disabled || loading) && styles.disabled,
        pressed && !disabled && { opacity: 0.84, transform: [{ scale: 0.985 }] },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={palette.fg} size="small" /> : null}
      {!loading && icon ? <Feather name={icon} size={size === 'sm' ? 15 : 17} color={palette.fg} /> : null}
      <TextBlock size={size === 'sm' ? 13 : 15} weight="semibold" color={palette.fg} numberOfLines={1}>{title}</TextBlock>
    </Pressable>
  );
}

export function IconButton({ icon, onPress, accessibilityLabel, color, filled = false, badge }: { icon: IconName; onPress: () => void; accessibilityLabel: string; color?: string; filled?: boolean; badge?: boolean }) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={6}
      style={({ pressed }) => [styles.iconButton, filled && { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 }, pressed && { opacity: 0.6 }]}
    >
      <Feather name={icon} size={19} color={color ?? colors.foreground} />
      {badge ? <View style={[styles.badge, { backgroundColor: colors.warmAccent, borderColor: colors.background }]} /> : null}
    </Pressable>
  );
}

export function StatusPill({ label, tone = 'neutral', icon }: { label: string; tone?: Tone; icon?: IconName }) {
  const colors = useColors();
  const palette = {
    neutral: { bg: colors.muted, fg: colors.mutedForeground },
    green: { bg: colors.successBackground, fg: colors.successForeground },
    amber: { bg: colors.warningBackground, fg: colors.warningForeground },
    red: { bg: colors.dangerBackground, fg: colors.dangerForeground },
    blue: { bg: colors.accent, fg: colors.accentForeground },
  }[tone];
  return (
    <View style={[styles.pill, { backgroundColor: palette.bg }]} accessibilityLabel={`Status: ${label}`}>
      {icon ? <Feather name={icon} size={11} color={palette.fg} /> : <View style={[styles.pillDot, { backgroundColor: palette.fg }]} />}
      <TextBlock size={11} weight="semibold" color={palette.fg}>{label}</TextBlock>
    </View>
  );
}

export function Notice({ title, body, tone = 'info', action, onAction }: { title: string; body?: string; tone?: 'info' | 'warning' | 'danger' | 'success'; action?: string; onAction?: () => void }) {
  const colors = useColors();
  const palette = {
    info: { bg: colors.infoBackground, border: colors.border, fg: colors.primary, icon: 'info' as IconName },
    warning: { bg: colors.warningBackground, border: colors.warningBorder, fg: colors.warningForeground, icon: 'alert-triangle' as IconName },
    danger: { bg: colors.dangerBackground, border: colors.dangerBorder, fg: colors.dangerForeground, icon: 'alert-octagon' as IconName },
    success: { bg: colors.successBackground, border: colors.border, fg: colors.successForeground, icon: 'check-circle' as IconName },
  }[tone];
  return (
    <View style={[styles.notice, { backgroundColor: palette.bg, borderColor: palette.border }]} accessibilityRole={tone === 'danger' ? 'alert' : undefined}>
      <Feather name={palette.icon} size={17} color={palette.fg} style={{ marginTop: 1 }} />
      <View style={{ flex: 1, gap: 3 }}>
        <TextBlock size={13} weight="semibold">{title}</TextBlock>
        {body ? <TextBlock size={12} color={colors.mutedForeground} style={{ lineHeight: 17 }}>{body}</TextBlock> : null}
        {action ? <Pressable onPress={onAction} hitSlop={8} style={{ marginTop: 4 }} accessibilityRole="button"><TextBlock size={12} weight="semibold" color={palette.fg}>{action} →</TextBlock></Pressable> : null}
      </View>
    </View>
  );
}

export function EmptyState({ icon, title, body, action }: { icon: IconName; title: string; body: string; action?: ReactNode }) {
  const colors = useColors();
  return (
    <View style={styles.empty}>
      <View style={[styles.emptyIcon, { backgroundColor: colors.accent }]}><Feather name={icon} size={23} color={colors.primary} /></View>
      <TextBlock size={17} weight="semibold" style={{ textAlign: 'center' }}>{title}</TextBlock>
      <TextBlock size={13} color={colors.mutedForeground} style={styles.emptyBody}>{body}</TextBlock>
      {action ? <View style={{ alignSelf: 'stretch', marginTop: 6 }}>{action}</View> : null}
    </View>
  );
}

export function Divider({ inset = 0 }: { inset?: number }) {
  const colors = useColors();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: inset }} />;
}

export function Chip({ label, selected, onPress, icon, count }: { label: string; selected: boolean; onPress: () => void; icon?: IconName; count?: number }) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => [styles.chip, { backgroundColor: selected ? colors.primary : colors.card, borderColor: selected ? colors.primary : colors.border }, pressed && { opacity: 0.8 }]}
    >
      {icon ? <Feather name={icon} size={13} color={selected ? colors.primaryForeground : colors.mutedForeground} /> : null}
      <TextBlock size={13} weight="semibold" color={selected ? colors.primaryForeground : colors.mutedForeground}>{label}</TextBlock>
      {count !== undefined ? <TextBlock size={11} weight="bold" color={selected ? colors.primaryForeground : colors.mutedForeground} style={{ opacity: 0.8 }}>{count}</TextBlock> : null}
    </Pressable>
  );
}

export function ChipRow({ children }: { children: ReactNode }) {
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow} style={{ flexGrow: 0, marginHorizontal: -20 }}>{children}</ScrollView>;
}

/** Equal-width segmented control. */
export function Segmented<T extends string>({ options, value, onChange, error }: { options: { label: string; value: T }[]; value: T; onChange: (value: T) => void; error?: string }) {
  const colors = useColors();
  return (
    <View style={{ gap: 6 }}>
      <View style={[styles.segmented, { borderColor: error ? colors.destructive : colors.border, backgroundColor: colors.muted }]} accessibilityRole="radiogroup">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable key={option.value} onPress={() => onChange(option.value)} accessibilityRole="radio" accessibilityState={{ selected }} style={[styles.segment, selected && { backgroundColor: colors.card, shadowColor: colors.shadow, shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 }]}>
              <TextBlock size={13} weight="semibold" color={selected ? colors.foreground : colors.mutedForeground} numberOfLines={1}>{option.label}</TextBlock>
            </Pressable>
          );
        })}
      </View>
      {error ? <View style={styles.errorRow}><Feather name="alert-circle" size={13} color={colors.dangerForeground} /><TextBlock size={12} color={colors.dangerForeground} style={{ flex: 1 }}>{error}</TextBlock></View> : null}
    </View>
  );
}

export function Checkbox({ checked, onToggle, label, testID }: { checked: boolean; onToggle: () => void; label: string; testID?: string }) {
  const colors = useColors();
  return (
    <Pressable onPress={onToggle} style={styles.checkRow} accessibilityRole="checkbox" accessibilityState={{ checked }} testID={testID}>
      <View style={[styles.checkbox, { borderColor: checked ? colors.primary : colors.input, backgroundColor: checked ? colors.primary : colors.card }]}>{checked ? <Feather name="check" size={14} color={colors.primaryForeground} /> : null}</View>
      <TextBlock size={14} style={{ flex: 1, lineHeight: 20 }}>{label}</TextBlock>
    </Pressable>
  );
}

export function KeyValue({ label, value, strong = false, mono = false }: { label: string; value: string; strong?: boolean; mono?: boolean }) {
  const colors = useColors();
  return (
    <View style={styles.keyValue}>
      <TextBlock size={13} color={colors.mutedForeground}>{label}</TextBlock>
      <TextBlock size={13} weight={strong ? 'bold' : 'medium'} selectable style={[{ maxWidth: '62%', textAlign: 'right' }, mono && { letterSpacing: 0.6 }]}>{value || '—'}</TextBlock>
    </View>
  );
}

export function ListRow({ icon, title, detail, onPress, right, tone, testID }: { icon: IconName; title: string; detail?: string; onPress?: () => void; right?: ReactNode; tone?: 'danger'; testID?: string }) {
  const colors = useColors();
  const fg = tone === 'danger' ? colors.dangerForeground : colors.primary;
  return (
    <Pressable onPress={onPress} disabled={!onPress} testID={testID} accessibilityRole={onPress ? 'button' : undefined} style={({ pressed }) => [styles.listRow, pressed && { backgroundColor: colors.muted }]}>
      <View style={[styles.listIcon, { backgroundColor: tone === 'danger' ? colors.dangerBackground : colors.accent }]}><Feather name={icon} size={16} color={fg} /></View>
      <View style={{ flex: 1, gap: 3 }}>
        <TextBlock size={14} weight="semibold" color={tone === 'danger' ? colors.dangerForeground : undefined}>{title}</TextBlock>
        {detail ? <TextBlock size={12} color={colors.mutedForeground} numberOfLines={2}>{detail}</TextBlock> : null}
      </View>
      {right ?? (onPress ? <Feather name="chevron-right" size={17} color={colors.mutedForeground} /> : null)}
    </Pressable>
  );
}

export function ProgressSteps({ steps, current }: { steps: string[]; current: number }) {
  const colors = useColors();
  return (
    <View style={styles.progress} accessibilityLabel={`Step ${current + 1} of ${steps.length}: ${steps[current]}`}>
      {steps.map((step, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <React.Fragment key={step}>
            {index > 0 ? <View style={[styles.progressLine, { backgroundColor: done || active ? colors.primary : colors.border }]} /> : null}
            <View style={styles.progressStep}>
              <View style={[styles.progressDot, { backgroundColor: done || active ? colors.primary : colors.muted, borderColor: active ? colors.accent : 'transparent' }]}>
                {done ? <Feather name="check" size={12} color={colors.primaryForeground} /> : <TextBlock size={11} weight="bold" color={active ? colors.primaryForeground : colors.mutedForeground}>{index + 1}</TextBlock>}
              </View>
              <TextBlock size={11} weight={active ? 'semibold' : 'regular'} color={active ? colors.primary : colors.mutedForeground}>{step}</TextBlock>
            </View>
          </React.Fragment>
        );
      })}
    </View>
  );
}

export function StatCard({ label, value, icon, tone = 'neutral', onPress, hint, testID }: { label: string; value: string; icon: IconName; tone?: Tone; onPress?: () => void; hint?: string; testID?: string }) {
  const colors = useColors();
  const palette = { neutral: [colors.muted, colors.mutedForeground], green: [colors.successBackground, colors.successForeground], amber: [colors.warningBackground, colors.warningForeground], red: [colors.dangerBackground, colors.dangerForeground], blue: [colors.accent, colors.accentForeground] }[tone];
  return (
    <Pressable onPress={onPress} testID={testID} accessibilityRole="button" accessibilityLabel={`${label}: ${value}`} style={({ pressed }) => [styles.stat, { backgroundColor: colors.card, borderColor: colors.border }, pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] }]}>
      <View style={styles.statTop}>
        <View style={[styles.statIcon, { backgroundColor: palette[0] }]}><Feather name={icon} size={15} color={palette[1]} /></View>
        <Feather name="arrow-up-right" size={14} color={colors.mutedForeground} />
      </View>
      <TextBlock size={26} weight="bold" style={{ letterSpacing: -0.8 }}>{value}</TextBlock>
      <View style={{ gap: 1 }}>
        <TextBlock size={12} weight="medium" color={colors.mutedForeground} numberOfLines={1}>{label}</TextBlock>
        {hint ? <TextBlock size={10} color={colors.mutedForeground} numberOfLines={1}>{hint}</TextBlock> : null}
      </View>
    </Pressable>
  );
}

export function Skeleton({ height = 16, width = '100%', radius = 8 }: { height?: number; width?: number | `${number}%`; radius?: number }) {
  const colors = useColors();
  const pulse = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: Platform.OS !== 'web' }),
      Animated.timing(pulse, { toValue: 0.5, duration: 700, useNativeDriver: Platform.OS !== 'web' }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return <Animated.View style={{ height, width, borderRadius: radius, backgroundColor: colors.muted, opacity: pulse }} />;
}

/** Bottom sheet built on Modal so it works on iOS, Android and web. */
export function Sheet({ visible, onClose, title, subtitle, children, footer, scroll = true, tall = false }: { visible: boolean; onClose: () => void; title: string; subtitle?: string; children: ReactNode; footer?: ReactNode; scroll?: boolean; tall?: boolean }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingViewCompat style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }]} onPress={onClose} accessibilityLabel="Close sheet" />
        <View style={[styles.sheet, tall && styles.sheetTall, { backgroundColor: colors.elevated, borderColor: colors.border, paddingBottom: insets.bottom + 14 }]} accessibilityViewIsModal>
          <View style={[styles.grabber, { backgroundColor: colors.input }]} />
          <View style={styles.sheetHeader}>
            <View style={{ flex: 1, gap: 3 }}>
              <TextBlock size={18} weight="bold">{title}</TextBlock>
              {subtitle ? <TextBlock size={12} color={colors.mutedForeground}>{subtitle}</TextBlock> : null}
            </View>
            <IconButton icon="x" onPress={onClose} accessibilityLabel="Close" />
          </View>
          {scroll ? <ScrollView keyboardShouldPersistTaps="handled" style={{ flexGrow: 0 }} contentContainerStyle={{ paddingBottom: 6 }}>{children}</ScrollView> : children}
          {footer ? <View style={{ paddingHorizontal: 18, paddingTop: 10 }}>{footer}</View> : null}
        </View>
      </KeyboardAvoidingViewCompat>
    </Modal>
  );
}

export type SelectOption = { value: string; label: string; detail?: string };

/** Searchable picker used for states, saved parties, products and transporters. */
export function SelectSheet({ visible, onClose, title, options, value, onSelect, searchable = true, emptyText = 'Nothing saved yet.', footer }: { visible: boolean; onClose: () => void; title: string; options: SelectOption[]; value?: string; onSelect: (value: string) => void; searchable?: boolean; emptyText?: string; footer?: ReactNode }) {
  const colors = useColors();
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const clean = query.trim().toLowerCase();
    return clean ? options.filter((option) => `${option.label} ${option.detail ?? ''} ${option.value}`.toLowerCase().includes(clean)) : options;
  }, [options, query]);
  useEffect(() => { if (!visible) setQuery(''); }, [visible]);
  return (
    // Long lists open tall, so more rows are visible and easy to scroll.
    <Sheet visible={visible} onClose={onClose} title={title} footer={footer} scroll={false} tall={options.length > 6}>
      {searchable ? (
        <View style={[styles.sheetSearch, { borderColor: colors.input, backgroundColor: colors.card }]}>
          <Feather name="search" size={16} color={colors.mutedForeground} />
          <TextInput value={query} onChangeText={setQuery} placeholder="Search" placeholderTextColor={colors.mutedForeground} style={[styles.sheetSearchInput, { color: colors.foreground }]} autoCorrect={false} accessibilityLabel={`Search ${title}`} />
        </View>
      ) : null}
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.value}
        keyboardShouldPersistTaps="handled"
        style={options.length > 6 ? { flex: 1 } : { maxHeight: 420 }}
        contentContainerStyle={{ paddingHorizontal: 10, paddingBottom: 6 }}
        ListEmptyComponent={<TextBlock size={13} color={colors.mutedForeground} style={{ textAlign: 'center', padding: 24 }}>{query ? 'No matches.' : emptyText}</TextBlock>}
        renderItem={({ item }) => {
          const selected = item.value === value;
          return (
            <Pressable onPress={() => { onSelect(item.value); onClose(); }} accessibilityRole="button" accessibilityState={{ selected }} style={({ pressed }) => [styles.option, { backgroundColor: selected ? colors.accent : pressed ? colors.muted : 'transparent' }]}>
              <View style={{ flex: 1, gap: 2 }}>
                <TextBlock size={14} weight={selected ? 'semibold' : 'medium'}>{item.label}</TextBlock>
                {item.detail ? <TextBlock size={12} color={colors.mutedForeground} numberOfLines={1}>{item.detail}</TextBlock> : null}
              </View>
              {selected ? <Feather name="check" size={17} color={colors.primary} /> : null}
            </Pressable>
          );
        }}
      />
    </Sheet>
  );
}

/** Field-looking button that opens a SelectSheet. */
export function SelectField({ label, value, placeholder, options, onSelect, error, required, title, testID }: { label: string; value: string; placeholder: string; options: SelectOption[]; onSelect: (value: string) => void; error?: string; required?: boolean; title?: string; testID?: string }) {
  const colors = useColors();
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);
  return (
    <View style={styles.fieldWrap}>
      <TextBlock size={13} weight="semibold" style={styles.fieldLabel}>{label}{required ? <TextBlock size={13} weight="semibold" color={colors.destructive}> *</TextBlock> : null}</TextBlock>
      <Pressable onPress={() => setOpen(true)} testID={testID} accessibilityRole="button" accessibilityLabel={`${label}: ${selected?.label ?? 'not selected'}`} style={[styles.inputShell, { backgroundColor: colors.card, borderColor: error ? colors.destructive : colors.input, borderWidth: error ? 1.5 : 1 }]}>
        <TextBlock size={15} color={selected || value ? colors.foreground : colors.mutedForeground} style={{ flex: 1, paddingVertical: 13 }} numberOfLines={1}>{selected?.label ?? (value || placeholder)}</TextBlock>
        <Feather name="chevron-down" size={18} color={colors.mutedForeground} />
      </Pressable>
      {error ? <View style={styles.errorRow}><Feather name="alert-circle" size={13} color={colors.dangerForeground} /><TextBlock size={12} color={colors.dangerForeground} style={{ flex: 1 }}>{error}</TextBlock></View> : null}
      <SelectSheet visible={open} onClose={() => setOpen(false)} title={title ?? label} options={options} value={value} onSelect={onSelect} searchable={options.length > 8} />
    </View>
  );
}

export function SearchBar({ value, onChangeText, placeholder, right, testID }: { value: string; onChangeText: (value: string) => void; placeholder: string; right?: ReactNode; testID?: string }) {
  const colors = useColors();
  return (
    <View style={[styles.search, { borderColor: colors.input, backgroundColor: colors.card }]}>
      <Feather name="search" size={17} color={colors.mutedForeground} />
      <TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={colors.mutedForeground} style={[styles.searchInput, { color: colors.foreground }]} returnKeyType="search" accessibilityLabel={placeholder} autoCorrect={false} testID={testID} />
      {value ? <Pressable onPress={() => onChangeText('')} hitSlop={10} accessibilityLabel="Clear search"><Feather name="x-circle" size={17} color={colors.mutedForeground} /></Pressable> : null}
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  loadMore: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14 },
  page: { paddingHorizontal: 20, gap: 18 },
  screenHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, paddingBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  headingRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  heading: { gap: 6, marginBottom: 1 },
  eyebrow: { letterSpacing: 1.2 },
  title: { letterSpacing: -0.7 },
  subtitle: { lineHeight: 21, marginTop: 1 },
  card: { borderWidth: 1, padding: 17, gap: 14 },
  sectionTitle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  count: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
  fieldWrap: { gap: 7 },
  // Wraps in a narrow column (Invoice number next to Date) so a tag never runs into the next field.
  labelRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', columnGap: 8, rowGap: 4 },
  fieldLabel: { marginLeft: 1 },
  inputShell: { minHeight: 52, borderWidth: 1, borderRadius: 14, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, gap: 8 },
  input: { flex: 1, paddingVertical: 13, fontSize: 15, fontFamily: 'Inter_400Regular', minWidth: 0 },
  multilineShell: { minHeight: 90, alignItems: 'stretch' },
  multilineInput: { minHeight: 72, textAlignVertical: 'top' },
  reveal: { padding: 4 },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  tag: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, flexShrink: 0 },
  button: { minHeight: 52, paddingHorizontal: 18, borderRadius: 15, borderWidth: 1, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 9 },
  buttonSm: { minHeight: 44, paddingHorizontal: 13, borderRadius: 12, gap: 7 },
  disabled: { opacity: 0.45 },
  iconButton: { width: 44, height: 44, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
  badge: { position: 'absolute', top: 9, right: 10, width: 9, height: 9, borderRadius: 5, borderWidth: 1.5 },
  pill: { alignSelf: 'flex-start', paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999, flexDirection: 'row', alignItems: 'center', gap: 5 },
  pillDot: { width: 6, height: 6, borderRadius: 3 },
  notice: { flexDirection: 'row', gap: 11, alignItems: 'flex-start', borderRadius: 16, borderWidth: 1, padding: 13 },
  empty: { alignItems: 'center', paddingHorizontal: 14, paddingVertical: 28, gap: 9 },
  emptyIcon: { width: 54, height: 54, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  emptyBody: { textAlign: 'center', lineHeight: 19, maxWidth: 300 },
  chipRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 20 },
  chip: { minHeight: 40, borderWidth: 1, paddingHorizontal: 14, borderRadius: 99, flexDirection: 'row', alignItems: 'center', gap: 6 },
  segmented: { flexDirection: 'row', borderWidth: 1, borderRadius: 14, padding: 3, gap: 3 },
  segment: { flex: 1, minHeight: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 11, paddingHorizontal: 6 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
  checkbox: { width: 24, height: 24, borderWidth: 1.5, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  keyValue: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, minHeight: 22 },
  listRow: { minHeight: 64, paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12 },
  listIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  progress: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'center', paddingVertical: 4 },
  progressStep: { alignItems: 'center', gap: 5, width: 78 },
  progressDot: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', borderWidth: 3 },
  progressLine: { height: 2, flex: 1, maxWidth: 40, marginTop: 12, borderRadius: 1, marginHorizontal: -18 },
  stat: { flexBasis: '47%', flexGrow: 1, borderWidth: 1, borderRadius: 18, padding: 13, gap: 8, minHeight: 124 },
  statTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statIcon: { width: 32, height: 32, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  sheetTall: { height: '88%' },
  sheet: { maxHeight: '88%', borderTopLeftRadius: 26, borderTopRightRadius: 26, borderWidth: 1, borderBottomWidth: 0, paddingTop: 8 },
  grabber: { width: 40, height: 5, borderRadius: 3, alignSelf: 'center', marginBottom: 6 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', paddingLeft: 20, paddingRight: 8, paddingBottom: 10 },
  sheetSearch: { marginHorizontal: 18, marginBottom: 8, height: 46, borderWidth: 1, borderRadius: 13, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  sheetSearchInput: { flex: 1, fontSize: 15, fontFamily: 'Inter_400Regular', paddingVertical: 8 },
  option: { minHeight: 52, borderRadius: 13, paddingHorizontal: 12, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 10 },
  search: { borderWidth: 1, borderRadius: 15, minHeight: 52, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 9 },
  searchInput: { flex: 1, fontSize: 15, fontFamily: 'Inter_400Regular', paddingVertical: 11, minWidth: 0 },
});

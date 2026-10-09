import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type KeyboardTypeOptions,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { TextBlock } from '@/components/AppUI';

type Tone = 'default' | 'danger' | 'success' | 'warning';
type IconName = keyof typeof Feather.glyphMap;

type ConfirmOptions = { title: string; message?: string; confirmLabel?: string; cancelLabel?: string; tone?: Tone; icon?: IconName };
type AlertOptions = { title: string; message?: string; okLabel?: string; tone?: Tone; icon?: IconName };
type PromptOptions = {
  title: string;
  message?: string;
  choices?: string[];
  inputLabel?: string;
  placeholder?: string;
  defaultValue?: string;
  keyboardType?: KeyboardTypeOptions;
  autoCapitalize?: 'none' | 'characters' | 'words' | 'sentences';
  requireInput?: boolean;
  confirmLabel?: string;
  tone?: Tone;
  validate?: (value: { choice: string; text: string }) => string | null;
};
type PromptResult = { choice: string; text: string } | null;

type Request =
  | { kind: 'confirm'; options: ConfirmOptions; resolve: (value: boolean) => void }
  | { kind: 'alert'; options: AlertOptions; resolve: () => void }
  | { kind: 'prompt'; options: PromptOptions; resolve: (value: PromptResult) => void };

type ToastItem = { id: number; message: string; tone: Tone };

type DialogApi = {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  alert: (options: AlertOptions) => Promise<void>;
  prompt: (options: PromptOptions) => Promise<PromptResult>;
  toast: (message: string, tone?: Tone) => void;
};

const DialogContext = createContext<DialogApi | null>(null);

function toneColors(colors: ReturnType<typeof useColors>, tone: Tone) {
  switch (tone) {
    case 'danger': return { bg: colors.dangerBackground, fg: colors.dangerForeground, solid: colors.destructive, solidFg: colors.destructiveForeground };
    case 'success': return { bg: colors.successBackground, fg: colors.successForeground, solid: colors.primary, solidFg: colors.primaryForeground };
    case 'warning': return { bg: colors.warningBackground, fg: colors.warningForeground, solid: colors.primary, solidFg: colors.primaryForeground };
    default: return { bg: colors.accent, fg: colors.primary, solid: colors.primary, solidFg: colors.primaryForeground };
  }
}

const defaultIcon: Record<Tone, IconName> = { default: 'info', danger: 'alert-octagon', success: 'check-circle', warning: 'alert-triangle' };

export function DialogProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<Request[]>([]);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastId = useRef(0);

  const push = useCallback((request: Request) => setQueue((current) => [...current, request]), []);
  const pop = useCallback(() => setQueue((current) => current.slice(1)), []);

  const api = useMemo<DialogApi>(() => ({
    confirm: (options) => new Promise<boolean>((resolve) => push({ kind: 'confirm', options, resolve })),
    alert: (options) => new Promise<void>((resolve) => push({ kind: 'alert', options, resolve })),
    prompt: (options) => new Promise<PromptResult>((resolve) => push({ kind: 'prompt', options, resolve })),
    toast: (message, tone = 'default') => {
      toastId.current += 1;
      const id = toastId.current;
      setToasts((current) => [...current.slice(-2), { id, message, tone }]);
      AccessibilityInfo.announceForAccessibility?.(message);
      if (tone === 'success') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      if (tone === 'danger') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
      setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 3200);
    },
  }), [push]);

  const active = queue[0];
  return (
    <DialogContext.Provider value={api}>
      {children}
      {active ? <DialogHost key={queue.length + active.kind + active.options.title} request={active} onDone={pop} /> : null}
      <ToastHost toasts={toasts} />
    </DialogContext.Provider>
  );
}

export function useDialog() {
  const value = useContext(DialogContext);
  if (!value) throw new Error('useDialog must be used inside DialogProvider.');
  return value;
}

function DialogHost({ request, onDone }: { request: Request; onDone: () => void }) {
  const colors = useColors();
  const scale = useRef(new Animated.Value(0.94)).current;
  // Visible from the first frame; only the scale animates.
  const opacity = useRef(new Animated.Value(1)).current;
  const [choice, setChoice] = useState(request.kind === 'prompt' ? request.options.choices?.[0] ?? '' : '');
  const [text, setText] = useState(request.kind === 'prompt' ? request.options.defaultValue ?? '' : '');
  const [error, setError] = useState('');
  const tone = request.options.tone ?? 'default';
  const palette = toneColors(colors, tone);
  const icon = request.kind === 'prompt' ? (tone === 'danger' ? 'alert-octagon' : 'edit-3') : request.options.icon ?? defaultIcon[tone];

  useEffect(() => {
    Animated.timing(scale, { toValue: 1, duration: 200, easing: Easing.out(Easing.back(1.4)), useNativeDriver: Platform.OS !== 'web' }).start();
    if (tone === 'danger') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
  }, [opacity, scale, tone]);

  // Resolve immediately: never make the result depend on an animation callback,
  // which can be skipped when the app is backgrounded or frames are throttled.
  const closed = useRef(false);
  const close = (after: () => void) => {
    if (closed.current) return;
    closed.current = true;
    after();
    onDone();
  };

  const cancel = () => {
    if (request.kind === 'confirm') close(() => request.resolve(false));
    else if (request.kind === 'alert') close(() => request.resolve());
    else close(() => request.resolve(null));
  };

  const accept = () => {
    if (request.kind === 'confirm') return close(() => request.resolve(true));
    if (request.kind === 'alert') return close(() => request.resolve());
    const value = { choice, text: text.trim() };
    if (request.options.requireInput && !value.text) return setError(`${request.options.inputLabel ?? 'This field'} is required.`);
    const problem = request.options.validate?.(value);
    if (problem) return setError(problem);
    return close(() => request.resolve(value));
  };

  const confirmLabel = request.kind === 'confirm' ? request.options.confirmLabel ?? 'Confirm'
    : request.kind === 'alert' ? request.options.okLabel ?? 'OK'
      : request.options.confirmLabel ?? 'Continue';
  const cancelLabel = request.kind === 'confirm' ? request.options.cancelLabel ?? 'Cancel' : 'Cancel';

  return (
    <Modal transparent visible animationType="none" onRequestClose={cancel} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <Animated.View style={[styles.backdrop, { backgroundColor: colors.overlay, opacity }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={request.kind === 'alert' ? accept : cancel} accessibilityLabel="Dismiss dialog" />
          <Animated.View
            accessibilityViewIsModal
            accessibilityRole="alert"
            style={[styles.dialog, { backgroundColor: colors.elevated, borderColor: colors.border, shadowColor: colors.shadow, transform: [{ scale }] }]}
          >
            <ScrollView bounces={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 14 }}>
              <View style={[styles.icon, { backgroundColor: palette.bg }]}><Feather name={icon} size={22} color={palette.fg} /></View>
              <View style={{ gap: 7 }}>
                <TextBlock size={18} weight="bold" style={{ letterSpacing: -0.3 }}>{request.options.title}</TextBlock>
                {request.options.message ? <TextBlock size={14} color={colors.mutedForeground} style={{ lineHeight: 20 }}>{request.options.message}</TextBlock> : null}
              </View>
              {request.kind === 'prompt' && request.options.choices?.length ? (
                <View style={{ gap: 7 }} accessibilityRole="radiogroup">
                  {request.options.choices.map((item) => {
                    const selected = item === choice;
                    return (
                      <Pressable key={item} onPress={() => { setChoice(item); setError(''); }} accessibilityRole="radio" accessibilityState={{ selected }} style={[styles.choice, { borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? colors.accent : colors.card }]}>
                        <View style={[styles.radio, { borderColor: selected ? colors.primary : colors.input }]}>{selected ? <View style={[styles.radioDot, { backgroundColor: colors.primary }]} /> : null}</View>
                        <TextBlock size={14} weight={selected ? 'semibold' : 'regular'}>{item}</TextBlock>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}
              {request.kind === 'prompt' && request.options.inputLabel ? (
                <View style={{ gap: 6 }}>
                  <TextBlock size={13} weight="semibold">{request.options.inputLabel}</TextBlock>
                  <TextInput
                    value={text}
                    onChangeText={(value) => { setText(value); setError(''); }}
                    placeholder={request.options.placeholder}
                    placeholderTextColor={colors.mutedForeground}
                    keyboardType={request.options.keyboardType}
                    autoCapitalize={request.options.autoCapitalize}
                    autoFocus={!request.options.choices?.length}
                    onSubmitEditing={accept}
                    style={[styles.input, { color: colors.foreground, borderColor: error ? colors.destructive : colors.input, backgroundColor: colors.card }]}
                  />
                </View>
              ) : null}
              {error ? <TextBlock size={12} color={colors.dangerForeground}>{error}</TextBlock> : null}
            </ScrollView>
            <View style={styles.actions}>
              {request.kind !== 'alert' ? (
                <Pressable onPress={cancel} style={({ pressed }) => [styles.action, { backgroundColor: colors.secondary, opacity: pressed ? 0.8 : 1 }]} accessibilityRole="button">
                  <TextBlock size={15} weight="semibold" color={colors.secondaryForeground}>{cancelLabel}</TextBlock>
                </Pressable>
              ) : null}
              <Pressable onPress={accept} style={({ pressed }) => [styles.action, { backgroundColor: palette.solid, opacity: pressed ? 0.85 : 1 }]} accessibilityRole="button" testID="dialog-confirm">
                <TextBlock size={15} weight="semibold" color={palette.solidFg}>{confirmLabel}</TextBlock>
              </Pressable>
            </View>
          </Animated.View>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function ToastHost({ toasts }: { toasts: ToastItem[] }) {
  const insets = useSafeAreaInsets();
  if (!toasts.length) return null;
  return (
    <View pointerEvents="none" style={[styles.toastHost, { top: (Platform.OS === 'web' ? 16 : insets.top) + 8 }]}>
      {toasts.map((toast) => <Toast key={toast.id} toast={toast} />)}
    </View>
  );
}

function Toast({ toast }: { toast: ToastItem }) {
  const colors = useColors();
  const translate = useRef(new Animated.Value(-16)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const palette = toneColors(colors, toast.tone);
  useEffect(() => {
    Animated.parallel([
      Animated.timing(translate, { toValue: 0, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: Platform.OS !== 'web' }),
    ]).start();
    const timer = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 250, useNativeDriver: Platform.OS !== 'web' }).start();
    }, 2800);
    return () => clearTimeout(timer);
  }, [opacity, translate]);
  return (
    <Animated.View accessibilityLiveRegion="polite" style={[styles.toast, { backgroundColor: colors.foreground, shadowColor: colors.shadow, opacity, transform: [{ translateY: translate }] }]}>
      <View style={[styles.toastIcon, { backgroundColor: palette.bg }]}><Feather name={defaultIcon[toast.tone]} size={14} color={palette.fg} /></View>
      <TextBlock size={13} weight="medium" color={colors.background} style={{ flex: 1 }}>{toast.message}</TextBlock>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 22 },
  dialog: { width: '100%', maxWidth: 400, maxHeight: '86%', borderRadius: 24, borderWidth: 1, padding: 20, gap: 18, shadowOpacity: 0.22, shadowRadius: 30, shadowOffset: { width: 0, height: 14 }, elevation: 18 },
  icon: { width: 46, height: 46, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', gap: 10 },
  action: { flex: 1, minHeight: 50, borderRadius: 15, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  choice: { minHeight: 48, borderWidth: 1, borderRadius: 14, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 11 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  input: { minHeight: 50, borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, fontSize: 15, fontFamily: 'Inter_400Regular' },
  toastHost: { position: 'absolute', left: 16, right: 16, alignItems: 'center', gap: 8, zIndex: 1000 },
  toast: { maxWidth: 440, width: '100%', minHeight: 48, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 10, shadowOpacity: 0.25, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 12 },
  toastIcon: { width: 26, height: 26, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
});

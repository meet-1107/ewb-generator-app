import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { IconButton, TextBlock } from '@/components/AppUI';
import { EwbGuideStrip } from '@/components/EwbGuideStrip';
import { KeyboardAvoidingViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useDialog } from '@/components/Dialog';
import { useColors } from '@/hooks/useColors';
import { api, type SupportChat, type SupportMessage, type SupportTopic } from '@/lib/api';
import { formatDate } from '@/lib/domain';
import { useAppStore } from '@/state/app-store';
import { refreshNotices } from '@/state/notices';
import { pushClient } from '@/lib/push';

const TOPICS: { value: SupportTopic; label: string; icon: React.ComponentProps<typeof Feather>['name']; ask: string }[] = [
  { value: 'ewb_login', label: 'E-way bill login', icon: 'key', ask: 'I need help with my e-way bill portal username and password.' },
  { value: 'payment', label: 'Payment', icon: 'credit-card', ask: 'I have a question about a payment.' },
  { value: 'credits', label: 'Credits', icon: 'database', ask: 'I have a question about my credits.' },
  { value: 'ewb_generate', label: 'Generating e-way bill', icon: 'truck', ask: 'I am facing an issue while generating an e-way bill.' },
  { value: 'other', label: 'Something else', icon: 'help-circle', ask: '' },
];

const WELCOME: SupportMessage = {
  id: 'welcome',
  at: '',
  from: 'bot',
  text: 'Hi! I am the E-Way Easy assistant.\n• Choose a topic below, or type your question.\n• I reply straight away.\n• Our support team also replies here within 24 hours.',
};

/** Shown when "Something else" is tapped, before the user types. */
const SOMETHING_ELSE: SupportMessage = { id: 'something-else', at: '', from: 'bot', text: '• Our team will review your concern within 24 hours.\n• Please type your concern below.' };

const time = (iso: string) => (iso ? formatDate(iso, true) : '');

/** Left panel → Contact details → Chat with support. */
export default function SupportScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const dialog = useDialog();
  const store = useAppStore();
  const [chat, setChat] = useState<SupportChat | null>(null);
  const [text, setText] = useState('');
  const [topic, setTopic] = useState<SupportTopic | undefined>();
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState('');
  const scroll = useRef<ScrollView>(null);
  const input = useRef<TextInput>(null);

  const sendingRef = useRef(false);
  const load = useCallback(async () => {
    try {
      const next = await api.supportChat(true);
      if (sendingRef.current) return;
      setChat(next);
      setFailed('');
    } catch (error) {
      setFailed((error as Error).message || 'Could not load the chat.');
    }
  }, []);

  // Opened straight from a link or at app start: wait until the sign-in is restored,
  // or the request goes without a token and the server answers "Sign in again".
  const ready = Boolean(store.workspaceId);
  useEffect(() => {
    if (!ready) return;
    void load();
    void refreshNotices();
    // New replies arrive as a push notification (PushManager refreshes on it) and on return to
    // the app, so the chat is not polled: a poll every few seconds per open chat adds up.
    const timer = setInterval(() => void load(), 120_000);
    const appState = AppState.addEventListener('change', (next) => { if (next === 'active') void load(); });
    const stopPush = pushClient?.onForeground((_title, _body, data) => { if (data?.route === 'support') void load(); });
    return () => { clearInterval(timer); appState.remove(); stopPush?.(); };
  }, [load, ready]);

  const send = async (message = text, chosen = topic) => {
    const body = message.trim();
    if (!body || sending || !ready) return;
    setSending(true);
    sendingRef.current = true;
    // Shown at once; the server's copy (with the assistant's answer) replaces it.
    setChat((current) => ({ ...(current ?? { status: 'open', unread: 0, topics: [] }), messages: [...(current?.messages ?? []), { id: `local-${Date.now()}`, at: new Date().toISOString(), from: 'user', text: body }] }));
    setText('');
    try {
      setChat(await api.sendSupportMessage(body, chosen));
      setTopic(undefined);
    } catch (error) {
      setText(body);
      await load();
      dialog.toast((error as Error).message || 'Message not sent. Try again.', 'danger');
    } finally {
      setSending(false);
      sendingRef.current = false;
    }
  };

  const pick = (item: (typeof TOPICS)[number]) => {
    if (item.ask) void send(item.ask, item.value);
    else {
      setTopic('other');
      setTimeout(() => input.current?.focus(), 150);
    }
  };

  const messages = [WELCOME, ...(chat?.messages ?? []), ...(topic === 'other' ? [SOMETHING_ELSE] : [])];
  const started = Boolean(chat?.messages.length);

  return (
    <KeyboardAvoidingViewCompat style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.header, { paddingTop: insets.top + 8, borderBottomColor: colors.border, backgroundColor: colors.card }]}>
        <IconButton icon="arrow-left" accessibilityLabel="Go back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))} />
        <View style={[styles.avatar, { backgroundColor: colors.primary }]}><Feather name="message-circle" size={18} color={colors.primaryForeground} /></View>
        <View style={{ flex: 1, gap: 1 }}>
          <TextBlock size={16} weight="bold">E-Way Easy support</TextBlock>
          <TextBlock size={12} color={colors.mutedForeground}>Instant answers · team replies within 24 hours</TextBlock>
        </View>
      </View>

      <ScrollView
        ref={scroll}
        style={{ flex: 1 }}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}
      >
        {!chat && !failed ? <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} /> : null}
        {failed && !chat ? <TextBlock size={13} color={colors.dangerForeground} style={{ textAlign: 'center' }}>{failed}</TextBlock> : null}
        {messages.map((message) => {
          const mine = message.from === 'user';
          const team = message.from === 'admin';
          return (
            <View key={message.id} style={{ gap: 8 }}>
            <View style={[styles.bubbleRow, mine && { justifyContent: 'flex-end' }]}>
              <View style={[styles.bubble, mine
                ? { backgroundColor: colors.primary, borderBottomRightRadius: 4 }
                : { backgroundColor: team ? colors.warmAccentSoft : colors.card, borderColor: team ? colors.warmAccent : colors.border, borderWidth: 1, borderBottomLeftRadius: 4 }]}
              >
                {!mine ? <TextBlock size={11} weight="bold" color={team ? colors.warningForeground : colors.primary}>{team ? 'Support team' : 'Assistant'}</TextBlock> : null}
                <TextBlock size={14} color={mine ? colors.primaryForeground : colors.foreground}>{message.text}</TextBlock>
                {message.at ? <TextBlock size={10} color={mine ? colors.primaryForeground : colors.mutedForeground} style={{ alignSelf: 'flex-end', opacity: 0.8 }}>{time(message.at)}</TextBlock> : null}
              </View>
            </View>
            {message.guide === 'ewb_login' ? <EwbGuideStrip /> : null}
            </View>
          );
        })}
        {sending ? <View style={styles.bubbleRow}><View style={[styles.bubble, { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 }]}><ActivityIndicator size="small" color={colors.primary} /></View></View> : null}

        {chat && !sending ? (
          <View style={{ gap: 8, marginTop: 4 }}>
            <TextBlock size={12} weight="semibold" color={colors.mutedForeground}>{started ? 'Another question?' : 'What do you need help with?'}</TextBlock>
            <View style={styles.chips}>
              {TOPICS.map((item) => (
                <Pressable
                  key={item.value}
                  onPress={() => pick(item)}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.chip, { borderColor: topic === item.value ? colors.primary : colors.border, backgroundColor: topic === item.value ? colors.accent : colors.card, opacity: pressed ? 0.7 : 1 }]}
                >
                  <Feather name={item.icon} size={14} color={colors.primary} />
                  <TextBlock size={13} weight="semibold" color={colors.primary}>{item.label}</TextBlock>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}
      </ScrollView>

      <View style={[styles.inputBar, { borderTopColor: colors.border, backgroundColor: colors.card, paddingBottom: insets.bottom + 10 }]}>
        <TextInput
          ref={input}
          value={text}
          onChangeText={setText}
          placeholder={topic === 'other' ? 'Describe your question…' : 'Type your message…'}
          placeholderTextColor={colors.mutedForeground}
          multiline
          maxLength={2000}
          style={[styles.input, { color: colors.foreground, backgroundColor: colors.background, borderColor: colors.input }]}
          testID="support-input"
        />
        <Pressable
          onPress={() => void send()}
          disabled={!text.trim() || sending}
          accessibilityRole="button"
          accessibilityLabel="Send message"
          style={({ pressed }) => [styles.send, { backgroundColor: colors.primary, opacity: !text.trim() || sending ? 0.45 : pressed ? 0.8 : 1 }]}
          testID="support-send"
        >
          <Feather name="send" size={18} color={colors.primaryForeground} />
        </Pressable>
      </View>
    </KeyboardAvoidingViewCompat>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  avatar: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  list: { padding: 14, gap: 10 },
  bubbleRow: { flexDirection: 'row' },
  bubble: { maxWidth: '86%', borderRadius: 16, paddingHorizontal: 13, paddingVertical: 9, gap: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 18, paddingHorizontal: 12, paddingVertical: 8 },
  inputBar: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 12, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth },
  input: { flex: 1, minHeight: 44, maxHeight: 120, borderWidth: 1, borderRadius: 22, paddingHorizontal: 16, paddingTop: 11, paddingBottom: 11, fontSize: 15 },
  send: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
});

import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Swipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Button, EmptyState, Heading, IconButton, Notice as Banner, Page, Skeleton, TextBlock } from '@/components/AppUI';
import { useDialog } from '@/components/Dialog';
import { useColors } from '@/hooks/useColors';
import { useAppStore } from '@/state/app-store';
import type { Notice } from '@/lib/api';
import { formatDate, relativeTime } from '@/lib/domain';
import { deleteNotices, markNoticesRead, openNotice, refreshNotices, useNotices } from '@/state/notices';

const ICONS: Record<Notice['kind'], React.ComponentProps<typeof Feather>['name']> = { credits: 'credit-card', payment: 'alert-circle', ewb: 'truck', support: 'message-circle' };

/**
 * The bell: the last 10 notifications. A tap opens the wallet or that e-way bill;
 * swiping a row to the right deletes it; Select picks several (or all) to delete.
 */
export default function NotificationsScreen() {
  const colors = useColors();
  const dialog = useDialog();
  const store = useAppStore();
  const { notices, unread, loaded, loading, error } = useNotices();
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);

  // Opened at app start: load once the sign-in is restored (an earlier request has no token).
  const ready = Boolean(store.workspaceId);
  useEffect(() => { if (ready) void refreshNotices(); }, [ready]);
  // Leave select mode once nothing is left to pick.
  useEffect(() => {
    if (!notices.length) setSelecting(false);
    setSelected((current) => current.filter((id) => notices.some((notice) => notice.id === id)));
  }, [notices]);

  const allSelected = notices.length > 0 && selected.length === notices.length;
  const toggle = (id: string) => setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  const stopSelecting = () => { setSelecting(false); setSelected([]); };

  const removeOne = async (notice: Notice) => {
    try {
      await deleteNotices([notice.id]);
      dialog.toast('Notification deleted');
    } catch (failure) {
      dialog.toast((failure as Error).message || 'Could not delete. Try again.', 'danger');
    }
  };

  const removeSelected = async () => {
    if (!selected.length) return;
    const everything = allSelected;
    const ok = await dialog.confirm({
      title: everything ? 'Delete all notifications?' : `Delete ${selected.length} notification${selected.length === 1 ? '' : 's'}?`,
      message: 'They are removed from this list on every phone. Your wallet and e-way bills are not changed.',
      confirmLabel: 'Delete',
      tone: 'danger',
      icon: 'trash-2',
    });
    if (!ok) return;
    setDeleting(true);
    try {
      await deleteNotices(everything ? undefined : selected);
      dialog.toast(everything ? 'All notifications deleted' : 'Deleted', 'success');
      stopSelecting();
    } catch (failure) {
      dialog.toast((failure as Error).message || 'Could not delete. Try again.', 'danger');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Page contentStyle={styles.page} tab={false} onRefresh={selecting ? undefined : () => void refreshNotices()} refreshing={loading && loaded}>
      <View style={styles.top}>
        {selecting ? (
          <>
            <Button title="Cancel" size="sm" variant="ghost" icon="x" onPress={stopSelecting} testID="notices-cancel" />
            <Button title={allSelected ? 'Unselect all' : 'Select all'} size="sm" variant="outline" icon={allSelected ? 'square' : 'check-square'} onPress={() => setSelected(allSelected ? [] : notices.map((notice) => notice.id))} testID="notices-select-all" />
          </>
        ) : (
          <>
            <IconButton icon="arrow-left" accessibilityLabel="Go back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))} />
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {unread ? <Button title="Mark all read" size="sm" variant="ghost" icon="check" onPress={() => void markNoticesRead()} testID="notices-read-all" /> : null}
              {notices.length ? <Button title="Select" size="sm" variant="outline" icon="check-square" onPress={() => setSelecting(true)} testID="notices-select" /> : null}
            </View>
          </>
        )}
      </View>
      <Heading title="Notifications" subtitle={selecting ? `${selected.length} selected` : unread ? `${unread} new` : 'Your last 10 updates'} />
      {error && !loaded ? <Banner title="Could not load notifications" body={error} tone="warning" action="Try again" onAction={() => void refreshNotices()} /> : null}
      {!loaded && !error ? (
        <View style={{ gap: 10 }}>{[0, 1, 2].map((key) => <Skeleton key={key} height={72} radius={14} />)}</View>
      ) : notices.length ? (
        <>
          {!selecting ? <TextBlock size={12} color={colors.mutedForeground}>Swipe a notification to the right to delete it.</TextBlock> : null}
          <View style={[styles.list, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius + 2 }]}>
            {notices.map((notice, index) => {
              const tone = notice.kind === 'payment' ? { bg: colors.warningBackground, fg: colors.warningForeground } : notice.kind === 'ewb' ? { bg: colors.accent, fg: colors.accentForeground } : { bg: colors.successBackground, fg: colors.successForeground };
              const checked = selected.includes(notice.id);
              const row = (
                <Pressable
                  onPress={() => (selecting ? toggle(notice.id) : openNotice(notice))}
                  onLongPress={() => { if (!selecting) { setSelecting(true); setSelected([notice.id]); } }}
                  accessibilityRole={selecting ? 'checkbox' : 'button'}
                  accessibilityState={selecting ? { checked } : undefined}
                  accessibilityLabel={`${notice.read ? '' : 'New. '}${notice.title}. ${notice.body}`}
                  accessibilityHint={selecting ? undefined : 'Swipe right to delete'}
                  testID={`notice-${index}`}
                  style={({ pressed }) => [styles.row, { backgroundColor: checked ? colors.accent : !notice.read ? colors.secondary : colors.card }, pressed && { opacity: 0.75 }]}
                >
                  {selecting ? (
                    <View style={[styles.check, { borderColor: checked ? colors.primary : colors.input, backgroundColor: checked ? colors.primary : 'transparent' }]}>
                      {checked ? <Feather name="check" size={14} color={colors.primaryForeground} /> : null}
                    </View>
                  ) : null}
                  <View style={[styles.icon, { backgroundColor: tone.bg }]}><Feather name={ICONS[notice.kind]} size={18} color={tone.fg} /></View>
                  <View style={{ flex: 1, gap: 3 }}>
                    <View style={styles.titleRow}>
                      <TextBlock size={14} weight={notice.read ? 'semibold' : 'bold'} style={{ flex: 1 }}>{notice.title}</TextBlock>
                      {!notice.read ? <View style={[styles.dot, { backgroundColor: colors.primary }]} /> : null}
                    </View>
                    <TextBlock size={13} color={colors.mutedForeground}>{notice.body}</TextBlock>
                    <View style={styles.meta}>
                      <TextBlock size={12} color={colors.mutedForeground}>{Date.now() - Date.parse(notice.at) < 86_400_000 ? relativeTime(notice.at) : formatDate(notice.at, true)}</TextBlock>
                      {!selecting ? <TextBlock size={12} weight="semibold" color={colors.primary}>{notice.route === 'ewb' ? 'View e-way bill' : notice.route === 'support' ? 'Open chat' : 'Open wallet'}</TextBlock> : null}
                    </View>
                  </View>
                </Pressable>
              );
              return (
                <View key={notice.id} style={index > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border } : undefined}>
                  {selecting ? row : (
                    <Swipeable
                      friction={1.6}
                      leftThreshold={90}
                      overshootLeft={false}
                      renderLeftActions={() => (
                        <View style={[styles.swipeDelete, { backgroundColor: colors.destructive }]}>
                          <Feather name="trash-2" size={20} color={colors.destructiveForeground} />
                          <TextBlock size={13} weight="bold" color={colors.destructiveForeground}>Delete</TextBlock>
                        </View>
                      )}
                      onSwipeableOpen={() => void removeOne(notice)}
                    >
                      {row}
                    </Swipeable>
                  )}
                </View>
              );
            })}
          </View>
        </>
      ) : (
        <EmptyState icon="bell" title="No notifications yet" body="You will see a notification here when you buy credits, a payment goes through, an e-way bill is generated or our support team replies." />
      )}
      {selecting ? (
        <Button title={selected.length ? `Delete ${allSelected ? 'all' : selected.length}` : 'Select notifications to delete'} icon="trash-2" variant="danger" disabled={!selected.length} loading={deleting} onPress={() => void removeSelected()} testID="notices-delete" />
      ) : null}
    </Page>
  );
}

const styles = StyleSheet.create({
  page: { gap: 14 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 40, gap: 8 },
  list: { borderWidth: 1, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 14, paddingVertical: 13 },
  check: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  icon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  meta: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, marginTop: 2 },
  swipeDelete: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 22 },
});

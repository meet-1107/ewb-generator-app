import React, { useEffect, useState } from 'react';
import { Linking, RefreshControl, ScrollView, Share, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card, Divider, EmptyState, KeyValue, ListRow, Notice, ScreenHeader, SectionTitle, StatCard, TextBlock } from '@/components/AppUI';
import { useDialog } from '@/components/Dialog';
import { useColors } from '@/hooks/useColors';
import { api, ApiError, SUPPORT_EMAIL, type WalletAction } from '@/lib/api';
import { formatDate } from '@/lib/domain';
import { useAppStore } from '@/state/app-store';

const COST_ROWS: { action: WalletAction; label: string }[] = [
  { action: 'generate', label: 'Generate a new e-way bill' },
  { action: 'part_b', label: 'Update Part-B (vehicle)' },
  { action: 'consolidate', label: 'Consolidated e-way bill' },
  { action: 'cancel', label: 'Cancel an e-way bill' },
  { action: 'extend', label: 'Extend validity' },
];

export default function WalletScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const store = useAppStore();
  const dialog = useDialog();
  const [refreshing, setRefreshing] = useState(false);
  const [adding, setAdding] = useState(false);
  const wallet = store.wallet;
  const testMode = store.config?.authMode === 'sandbox';

  useEffect(() => {
    void store.refreshWallet();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = async () => {
    setRefreshing(true);
    await store.refreshWallet();
    setRefreshing(false);
  };

  const addTestCredits = async () => {
    setAdding(true);
    try {
      await api.addTestCredits();
      await store.refreshWallet();
      dialog.toast('100 test credits added', 'success');
    } catch (error) {
      dialog.toast(error instanceof ApiError ? error.message : 'Could not add credits', 'danger');
    } finally {
      setAdding(false);
    }
  };

  const requestCredits = async () => {
    const id = store.workspaceId ?? '';
    const body = `Please add credits to my E-Way Easy wallet.\nWallet ID: ${id}\nCredits needed: `;
    if (SUPPORT_EMAIL) {
      await Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Add wallet credits')}&body=${encodeURIComponent(body)}`).catch(() => Share.share({ message: body }));
    } else {
      await Share.share({ message: body }).catch(() => undefined);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader title="Wallet" subtitle="Credits for e-way bill actions" />
      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 30 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
      >
        <Card style={{ ...styles.balance, backgroundColor: colors.primary }}>
          <TextBlock size={12} weight="bold" color={colors.primaryForeground}>AVAILABLE CREDITS</TextBlock>
          <TextBlock size={40} weight="bold" color={colors.primaryForeground}>{wallet ? String(wallet.balance) : '—'}</TextBlock>
          <TextBlock size={12} color={colors.primaryForeground}>
            {wallet ? `${wallet.creditsUsed} credits used so far` : store.online === false ? 'Offline — connect to see your balance' : 'Loading…'}
          </TextBlock>
        </Card>

        {wallet && wallet.balance < wallet.costs.generate ? (
          <Notice tone="warning" title="Low balance" body={`Generating an e-way bill needs ${wallet.costs.generate} credits. Add credits to keep generating.`} />
        ) : null}

        <View style={styles.stats}>
          <View style={styles.stat}><StatCard label="E-way bills generated" value={String(wallet?.counts.generate ?? 0)} icon="file-text" tone="green" /></View>
          <View style={styles.stat}><StatCard label="Part-B updates" value={String(wallet?.counts.part_b ?? 0)} icon="truck" /></View>
          <View style={styles.stat}><StatCard label="Consolidated" value={String(wallet?.counts.consolidate ?? 0)} icon="layers" /></View>
          <View style={styles.stat}><StatCard label="Cancelled" value={String(wallet?.counts.cancel ?? 0)} icon="x-circle" /></View>
        </View>

        <SectionTitle title="What each action costs" />
        <Card>
          {COST_ROWS.map((row, index) => (
            <React.Fragment key={row.action}>
              {index ? <Divider /> : null}
              <KeyValue label={row.label} value={wallet ? (wallet.costs[row.action] ? `${wallet.costs[row.action]} credits` : 'Free') : '—'} strong />
            </React.Fragment>
          ))}
          <TextBlock size={11} color={colors.mutedForeground}>Credits are taken only when the action succeeds. If the government portal rejects it, they are refunded automatically.</TextBlock>
        </Card>

        <SectionTitle title="Add credits" />
        <Card>
          {testMode ? (
            <>
              <TextBlock size={13} color={colors.mutedForeground}>Test workspace: add free test credits to try the flow.</TextBlock>
              <Button title="Add 100 test credits" icon="plus" variant="outline" onPress={() => void addTestCredits()} loading={adding} />
            </>
          ) : (
            <>
              <TextBlock size={13} color={colors.mutedForeground}>Send a request with your wallet ID and we will add credits after payment.</TextBlock>
              <KeyValue label="Wallet ID" value={store.workspaceId ?? '—'} mono />
              <Button title="Request credits" icon="mail" variant="outline" onPress={() => void requestCredits()} />
            </>
          )}
        </Card>

        <SectionTitle title="History" count={wallet?.ledger.length} />
        {wallet?.ledger.length ? (
          <Card style={{ padding: 0, gap: 0 }}>
            {wallet.ledger.map((entry, index) => (
              <React.Fragment key={entry.id}>
                {index ? <Divider inset={64} /> : null}
                <ListRow
                  icon={entry.credits > 0 ? 'plus-circle' : entry.status === 'refunded' ? 'rotate-ccw' : 'minus-circle'}
                  title={entry.status === 'refunded' ? `${entry.label} — refunded` : entry.label}
                  detail={[formatDate(entry.at, true), entry.ewbNumber ? `No. ${entry.ewbNumber}` : null, entry.note].filter(Boolean).join(' · ')}
                  right={
                    <TextBlock weight="bold" color={entry.status === 'refunded' ? colors.mutedForeground : entry.credits > 0 ? colors.successForeground : colors.foreground}>
                      {entry.status === 'refunded' ? '0' : `${entry.credits > 0 ? '+' : ''}${entry.credits}`}
                    </TextBlock>
                  }
                />
              </React.Fragment>
            ))}
          </Card>
        ) : (
          <Card><EmptyState icon="credit-card" title="No activity yet" body="Every e-way bill action and credit top-up appears here." /></Card>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 14, maxWidth: 720, width: '100%', alignSelf: 'center' },
  balance: { gap: 4, borderWidth: 0 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  stat: { flexBasis: '47%', flexGrow: 1 },
});

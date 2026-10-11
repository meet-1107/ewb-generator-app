import React, { useEffect, useRef, useState } from 'react';
import * as WebBrowser from 'expo-web-browser';
import { Linking, Pressable, RefreshControl, ScrollView, Share, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card, Divider, EmptyState, Field, KeyValue, ListRow, Notice, ScreenHeader, SectionTitle, StatCard, TextBlock } from '@/components/AppUI';
import { useDialog } from '@/components/Dialog';
import { useColors } from '@/hooks/useColors';
import { api, ApiError, SUPPORT_EMAIL, type CreditPurchase, type WalletAction } from '@/lib/api';
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
  const [buying, setBuying] = useState<number | null>(null);
  // Taken before the confirm dialog, so a double tap cannot open two payment links.
  const buyGuard = useRef(false);
  const [custom, setCustom] = useState('');
  const wallet = store.wallet;
  const pricing = wallet?.pricing;
  const rupees = (credits: number) => `₹${((credits * (pricing?.creditPricePaise ?? 100)) / 100).toLocaleString('en-IN')}`;

  useEffect(() => {
    void store.refreshWallet();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = async () => {
    setRefreshing(true);
    await store.refreshWallet();
    setRefreshing(false);
  };

  /** Waits for Razorpay to report the payment (the webhook may also credit it first). */
  const confirmPaid = async (purchase: CreditPurchase) => {
    for (let attempt = 0; attempt < 6; attempt++) {
      const { purchase: latest, balance } = await api.purchaseStatus(purchase.id);
      if (latest.status === 'paid') {
        store.setWalletBalance(balance);
        dialog.toast(`${latest.credits} credits added`, 'success');
        return;
      }
      if (latest.status !== 'created') break;
      await new Promise((resolve) => setTimeout(resolve, 2500));
    }
    dialog.toast('Payment not confirmed yet. Credits are added automatically once it is.', 'default');
  };

  const buy = async (credits: number) => {
    if (!pricing || pricing.payments === 'off') return requestCredits();
    if (!Number.isInteger(credits) || credits < pricing.min || credits > pricing.max) {
      return dialog.toast(`Choose between ${pricing.min} and ${pricing.max.toLocaleString('en-IN')} credits.`, 'danger');
    }
    if (buyGuard.current) return;
    buyGuard.current = true;
    const ok = await dialog.confirm({ title: `Buy ${credits} credits?`, message: `You pay ${rupees(credits)} (1 credit = ${rupees(1)}).${pricing.payments === 'sandbox' ? ' Test workspace: no real payment is taken.' : ' You will finish the payment on Razorpay (UPI, card or net banking).'}`, confirmLabel: `Pay ${rupees(credits)}`, icon: 'credit-card' });
    if (!ok) { buyGuard.current = false; return; }
    setBuying(credits);
    try {
      const { purchase, balance } = await api.buyCredits(credits);
      if (purchase.status === 'paid') {
        store.setWalletBalance(balance);
        dialog.toast(`${credits} credits added`, 'success');
      } else if (purchase.shortUrl) {
        await WebBrowser.openBrowserAsync(purchase.shortUrl).catch(() => Linking.openURL(purchase.shortUrl!));
        await confirmPaid(purchase);
      }
      await store.refreshWallet();
      setCustom('');
    } catch (error) {
      dialog.toast(error instanceof ApiError ? error.message : 'Could not start the payment', 'danger');
    } finally {
      buyGuard.current = false;
      setBuying(null);
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

        <SectionTitle title="Buy credits" />
        {pricing && pricing.payments !== 'off' ? (
          <>
            <View style={styles.packs}>
              {pricing.packs.map((credits) => (
                <Pressable
                  key={credits}
                  onPress={() => void buy(credits)}
                  disabled={buying !== null}
                  accessibilityRole="button"
                  accessibilityLabel={`Buy ${credits} credits for ${rupees(credits)}`}
                  style={({ pressed }) => [styles.pack, { backgroundColor: colors.card, borderColor: colors.border }, pressed && { opacity: 0.8 }, buying === credits && { borderColor: colors.primary }]}
                >
                  <TextBlock size={22} weight="bold">{credits.toLocaleString('en-IN')}</TextBlock>
                  <TextBlock size={11} color={colors.mutedForeground}>credits</TextBlock>
                  <TextBlock size={14} weight="semibold" color={colors.primary}>{buying === credits ? 'Opening…' : rupees(credits)}</TextBlock>
                  <TextBlock size={10} color={colors.mutedForeground}>≈ {Math.floor(credits / (wallet?.costs.generate || 10))} e-way bills</TextBlock>
                </Pressable>
              ))}
            </View>
            <Card>
              <Field label="Other amount (credits)" value={custom} onChangeText={(value) => setCustom(value.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" placeholder={`${pricing.min} or more`} hint={custom ? `You pay ${rupees(Number(custom))}` : `1 credit = ${rupees(1)}`} />
              <Button title={custom ? `Buy ${custom} credits` : 'Buy'} icon="credit-card" onPress={() => void buy(Number(custom))} disabled={!custom || buying !== null} loading={buying === Number(custom)} />
              {pricing.payments === 'sandbox' ? <TextBlock size={11} color={colors.mutedForeground}>Test workspace: purchases are instant and free.</TextBlock> : <TextBlock size={11} color={colors.mutedForeground}>Secure payment by Razorpay. Credits are added as soon as the payment succeeds and never expire.</TextBlock>}
            </Card>
          </>
        ) : (
          <Card>
            <TextBlock size={13} color={colors.mutedForeground}>Online payment is not switched on yet. Send a request with your wallet ID and credits will be added after payment.</TextBlock>
            <KeyValue label="Wallet ID" value={store.workspaceId ?? '—'} mono />
            <Button title="Request credits" icon="mail" variant="outline" onPress={() => void requestCredits()} />
          </Card>
        )}

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
  packs: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  pack: { flexBasis: '30%', flexGrow: 1, borderWidth: 1, borderRadius: 16, padding: 12, gap: 2, alignItems: 'center' },
});

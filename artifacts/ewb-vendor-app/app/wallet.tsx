import React, { useEffect, useRef, useState } from 'react';
import * as WebBrowser from 'expo-web-browser';
import { router } from 'expo-router';
import { Linking, Pressable, RefreshControl, Share, StyleSheet, TextInput, View } from 'react-native';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card, Chip, ChipRow, Divider, EmptyState, Field, KeyValue, ListRow, Notice, ScreenHeader, SectionTitle, StatCard, TextBlock } from '@/components/AppUI';
import { useDialog } from '@/components/Dialog';
import { useColors } from '@/hooks/useColors';
import { api, ApiError, SUPPORT_EMAIL, type CreditPurchase, type WalletAction, type WalletEntry, type WalletSummary } from '@/lib/api';
import { formatDate } from '@/lib/domain';
import { useAppStore } from '@/state/app-store';

/** The "Other" choice among the quick-add packs. */
const OTHER = -1;

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
  /** Pack chosen on the balance card; the middle pack until the user picks one. */
  const [pick, setPick] = useState<number | null>(null);
  const packs = pricing?.packs ?? [];
  /** "Other": the user types any number of credits (150, 200…). */
  const other = pick === OTHER;
  const quickPack = other ? Number(custom) || 0 : pick && packs.includes(pick) ? pick : packs[Math.floor((packs.length - 1) / 2)] ?? 0;

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
      <KeyboardAwareScrollViewCompat
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 30 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
      >
        <Card style={{ ...styles.balance, backgroundColor: colors.primary }}>
          <TextBlock size={12} weight="bold" color={colors.primaryForeground}>AVAILABLE CREDITS</TextBlock>
          <TextBlock size={40} weight="bold" color={colors.primaryForeground}>{wallet ? String(wallet.balance) : '—'}</TextBlock>
          <TextBlock size={12} color={colors.primaryForeground}>
            {wallet ? `${wallet.creditsUsed} credits used so far` : store.online === false ? 'Offline — connect to see your balance' : 'Loading…'}
          </TextBlock>
          {pricing && pricing.payments !== 'off' && pricing.packs.length ? (
            <View style={styles.quickAdd}>
              <View style={styles.quickPacks} accessibilityRole="radiogroup">
                {pricing.packs.map((credits) => {
                  const selected = credits === quickPack;
                  return (
                    <Pressable
                      key={credits}
                      onPress={() => setPick(credits)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      accessibilityLabel={`${credits} credits for ${rupees(credits)}`}
                      style={[styles.quickPack, { borderColor: colors.primaryForeground, backgroundColor: selected ? colors.primaryForeground : 'transparent' }]}
                    >
                      <TextBlock size={13} weight="bold" color={selected ? colors.primary : colors.primaryForeground}>{credits.toLocaleString('en-IN')}</TextBlock>
                      <TextBlock size={10} color={selected ? colors.primary : colors.primaryForeground}>{rupees(credits)}</TextBlock>
                    </Pressable>
                  );
                })}
                <Pressable
                  onPress={() => setPick(OTHER)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: other }}
                  accessibilityLabel="Other amount"
                  style={[styles.quickPack, { borderColor: colors.primaryForeground, backgroundColor: other ? colors.primaryForeground : 'transparent' }]}
                  testID="wallet-quick-other"
                >
                  <TextBlock size={13} weight="bold" color={other ? colors.primary : colors.primaryForeground}>Other</TextBlock>
                  <TextBlock size={10} color={other ? colors.primary : colors.primaryForeground}>any amount</TextBlock>
                </Pressable>
              </View>
              {other ? (
                <TextInput
                  value={custom}
                  onChangeText={(value) => setCustom(value.replace(/\D/g, '').slice(0, 6))}
                  keyboardType="number-pad"
                  placeholder={`Credits, ${pricing.min} or more`}
                  placeholderTextColor={colors.mutedForeground}
                  autoFocus
                  style={[styles.quickInput, { backgroundColor: colors.primaryForeground, color: colors.primary }]}
                  accessibilityLabel="Number of credits"
                  testID="wallet-quick-custom"
                />
              ) : null}
              <Button
                title={buying !== null && buying === quickPack ? 'Opening…' : quickPack ? `Add ${quickPack.toLocaleString('en-IN')} credits · ${rupees(quickPack)}` : 'Enter the credits to add'}
                icon="plus"
                variant="outline"
                onPress={() => void buy(quickPack)}
                disabled={buying !== null || !quickPack}
                loading={buying !== null && buying === quickPack}
                testID="wallet-quick-add"
              />
            </View>
          ) : pricing ? (
            <Button title="Request credits" icon="mail" variant="outline" onPress={() => void requestCredits()} style={{ marginTop: 10 }} />
          ) : null}
        </Card>

        {wallet?.welcomeCredits ? (
          <Notice tone="success" title={`Get ${wallet.welcomeCredits} free credits`} body="Save your e-way bill portal API login for your GSTIN and we add free credits to try E-Way Easy. Once per GSTIN." action="Add portal login" onAction={() => router.push('/ewb-login')} />
        ) : wallet && wallet.balance < wallet.costs.generate ? (
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

        <Card style={{ padding: 0, gap: 0 }}>
          <ListRow icon="file-text" title="Billing invoices" detail="Invoices and history of your payments" onPress={() => router.push('/billing')} testID="wallet-billing" />
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
                  <TextBlock size={10} color={colors.mutedForeground}>≈ {Math.floor(credits / (wallet?.costs.generate || 5))} e-way bills</TextBlock>
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

        <WalletHistory wallet={wallet} />
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

/** Entries loaded at a time; Show more loads the next page from the server. */
const PAGE = 20;

function monthLabel(month: string) {
  return new Date(`${month}-01T00:00:00+05:30`).toLocaleString('en-IN', { month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
}

/**
 * Latest entries first (all months, or one month), PAGE at a time: Show more
 * loads only the next page, so nothing is fetched that the user does not open.
 */
function WalletHistory({ wallet }: { wallet: WalletSummary | null }) {
  const colors = useColors();
  const months = wallet?.historyMonths ?? [];
  const [month, setMonth] = useState<string | null>(null);
  /** Pages loaded after the first; null while the first page of a month loads. */
  const [entries, setEntries] = useState<WalletEntry[] | null>(null);
  const [more, setMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');

  // First page: "Recent" comes with the wallet; a month is fetched. Both start
  // over whenever the wallet refreshes (new charges, top-ups).
  useEffect(() => {
    setError('');
    if (!month) {
      setEntries(wallet?.ledger.slice(0, PAGE) ?? []);
      setMore(wallet?.ledgerMore ?? (wallet?.ledger.length ?? 0) > PAGE);
      return;
    }
    let active = true;
    setEntries(null);
    api.walletHistory(month, PAGE)
      .then((result) => {
        if (!active) return;
        setEntries(result.entries);
        setMore(result.more);
      })
      .catch((caught: unknown) => active && setError(caught instanceof ApiError ? caught.message : 'Could not load this month.'));
    return () => {
      active = false;
    };
  }, [month, wallet]);

  const showMore = async () => {
    const last = entries?.[entries.length - 1];
    if (!last || loadingMore) return;
    setLoadingMore(true);
    setError('');
    try {
      const result = await api.walletHistory(month ?? '', PAGE, last.id);
      setEntries((current) => [...(current ?? []), ...result.entries.filter((entry) => !current?.some((item) => item.id === entry.id))]);
      setMore(result.more);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not load more entries.');
    } finally {
      setLoadingMore(false);
    }
  };

  const summary = months.find((item) => item.month === month);
  const shown = entries ?? [];

  return (
    <>
      <SectionTitle title="History" />
      {months.length ? (
        <ChipRow>
          <Chip label="Recent" icon="clock" selected={!month} onPress={() => setMonth(null)} />
          {months.map((item) => <Chip key={item.month} label={monthLabel(item.month)} count={item.count} selected={month === item.month} onPress={() => setMonth(item.month)} />)}
        </ChipRow>
      ) : null}
      {summary ? (
        <TextBlock size={12} color={colors.mutedForeground}>{`${summary.count} entries · +${summary.added} added · ${summary.used} used`}</TextBlock>
      ) : null}
      {error ? <Notice title="Check this" body={error} tone="warning" /> : null}
      {month && !entries && !error ? (
        <Card><TextBlock size={13} color={colors.mutedForeground}>Loading {monthLabel(month)}…</TextBlock></Card>
      ) : shown.length ? (
        <Card style={{ padding: 0, gap: 0 }}>
          {shown.map((entry, index) => (
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
      ) : month ? null : (
        <Card><EmptyState icon="credit-card" title="No activity yet" body="Every e-way bill action and credit top-up appears here." /></Card>
      )}
      {entries && more ? (
        <Button title={loadingMore ? 'Loading…' : 'Show more'} icon="chevrons-down" variant="outline" onPress={() => void showMore()} loading={loadingMore} disabled={loadingMore} testID="wallet-history-more" />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 14, maxWidth: 720, width: '100%', alignSelf: 'center' },
  balance: { gap: 4, borderWidth: 0 },
  quickAdd: { gap: 10, marginTop: 10 },
  quickPacks: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  quickInput: { borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 16, fontWeight: '600' },
  quickPack: { flexGrow: 1, flexBasis: '30%', borderWidth: 1, borderRadius: 12, paddingVertical: 7, alignItems: 'center', gap: 1 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  stat: { flexBasis: '47%', flexGrow: 1 },
  packs: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  pack: { flexBasis: '30%', flexGrow: 1, borderWidth: 1, borderRadius: 16, padding: 12, gap: 2, alignItems: 'center' },
});

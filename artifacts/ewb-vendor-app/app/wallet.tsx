import React, { useEffect, useRef, useState } from 'react';
import * as WebBrowser from 'expo-web-browser';
import { router } from 'expo-router';
import { ActivityIndicator, AppState, Linking, Platform, Pressable, RefreshControl, Share, StyleSheet, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card, Chip, ChipRow, Divider, EmptyState, Field, KeyValue, ListRow, Notice, ScreenHeader, SectionTitle, Sheet, StatCard, TextBlock } from '@/components/AppUI';
import { useDialog } from '@/components/Dialog';
import { useColors } from '@/hooks/useColors';
import { useWelcomeCredits } from '@/hooks/useWelcomeCredits';
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
  const welcomeCredits = useWelcomeCredits();
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

  /** Credits shown on the secure checkout sheet before paying; null when it is closed. */
  const [checkout, setCheckout] = useState<number | null>(null);
  /** A payment being confirmed with Razorpay after the user came back from it. */
  const [confirming, setConfirming] = useState<CreditPurchase | null>(null);

  /** Paid: straight to Home, which shows the new balance and what was added. */
  const paid = (credits: number, balance: number | undefined) => {
    store.setWalletBalance(balance);
    void store.refreshWallet();
    router.replace({ pathname: '/(tabs)', params: { credited: String(credits) } });
  };

  /** Waits for Razorpay to report the payment (the webhook may also credit it first). */
  const confirmPaid = async (purchase: CreditPurchase) => {
    setConfirming(purchase);
    try {
      for (let attempt = 0; attempt < 6; attempt++) {
        const { purchase: latest, balance } = await api.purchaseStatus(purchase.id);
        if (latest.status === 'paid') return paid(latest.credits, balance);
        if (latest.status !== 'created') break;
        await new Promise((resolve) => setTimeout(resolve, 2500));
      }
      dialog.toast('Payment not confirmed yet. Credits are added automatically once it is.', 'default');
    } catch {
      dialog.toast('Could not check the payment right now. If you paid, credits are added automatically within a few minutes.', 'default');
    } finally {
      setConfirming(null);
      void store.refreshWallet();
    }
  };

  // Android: the payment page opens on top and openBrowserAsync returns at once, so the
  // payment is checked when the user comes back to the app instead.
  const awaitingPayment = useRef<CreditPurchase | null>(null);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      const purchase = awaitingPayment.current;
      if (next !== 'active' || !purchase) return;
      awaitingPayment.current = null;
      void confirmPaid(purchase);
    });
    return () => subscription.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const buy = async (credits: number) => {
    if (!pricing || pricing.payments === 'off') return requestCredits();
    if (!Number.isInteger(credits) || credits < pricing.min || credits > pricing.max) {
      return dialog.toast(`Choose between ${pricing.min} and ${pricing.max.toLocaleString('en-IN')} credits.`, 'danger');
    }
    setCheckout(credits);
  };

  /** "Pay securely" on the checkout sheet: opens Razorpay, then confirms the payment. */
  const pay = async (credits: number) => {
    if (buyGuard.current) return;
    buyGuard.current = true;
    setCheckout(null);
    setBuying(credits);
    try {
      const { purchase, balance } = await api.buyCredits(credits);
      if (purchase.status === 'paid') {
        paid(credits, balance);
        return;
      } else if (purchase.shortUrl) {
        if (Platform.OS === 'android') awaitingPayment.current = purchase;
        await WebBrowser.openBrowserAsync(purchase.shortUrl).catch(() => Linking.openURL(purchase.shortUrl!));
        if (Platform.OS !== 'android') await confirmPaid(purchase);
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
        {confirming ? (
          <Card style={styles.confirming}>
            <ActivityIndicator color={colors.primary} />
            <View style={{ flex: 1, gap: 2 }}>
              <TextBlock size={14} weight="bold">Confirming your payment…</TextBlock>
              <TextBlock size={12} color={colors.mutedForeground}>{confirming.credits} credits · {rupees(confirming.credits)}. Please keep the app open; this takes a few seconds.</TextBlock>
            </View>
          </Card>
        ) : null}
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

        {welcomeCredits ? (
          <Notice tone="success" title={`Get ${welcomeCredits} free credits`} body="Save your e-way bill portal API login for your GSTIN and we add free credits to try E-Way Easy. Once per GSTIN." action="Add portal login" onAction={() => router.push('/ewb-login')} />
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
          {wallet?.gstLookups ? (
            <>
              <Divider />
              <KeyValue
                label={`Verify a new party GSTIN (first ${wallet.gstLookups.free} free · ${Math.max(0, wallet.gstLookups.free - wallet.gstLookups.used)} left)`}
                value={wallet.costs.gst_verify ? `${wallet.costs.gst_verify} credit${wallet.costs.gst_verify === 1 ? '' : 's'}` : 'Free'}
                strong
              />
            </>
          ) : null}
          <TextBlock size={11} color={colors.mutedForeground}>Credits are taken only when the action succeeds. If the government portal rejects it, they are refunded automatically. A GSTIN verified before is always free.</TextBlock>
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

      <Sheet
        visible={checkout !== null}
        onClose={() => setCheckout(null)}
        title="Secure checkout"
        subtitle="Check your order before paying"
        footer={checkout !== null ? (
          <View style={{ gap: 8 }}>
            <Button title={`Pay ${rupees(checkout)} securely`} icon="lock" onPress={() => void pay(checkout)} testID="wallet-pay" />
            <TextBlock size={11} color={colors.mutedForeground} style={{ textAlign: 'center' }}>
              {pricing?.payments === 'sandbox' ? 'Test workspace: no real payment is taken.' : 'You finish the payment on Razorpay’s secure page (razorpay.com).'}
            </TextBlock>
          </View>
        ) : undefined}
      >
        {checkout !== null ? (
          <View style={{ paddingHorizontal: 18, gap: 14 }}>
            <View style={[styles.amount, { backgroundColor: colors.muted }]}>
              <TextBlock size={12} weight="semibold" color={colors.mutedForeground}>YOU PAY</TextBlock>
              <TextBlock size={32} weight="bold">{rupees(checkout)}</TextBlock>
              <TextBlock size={13} color={colors.mutedForeground}>for {checkout.toLocaleString('en-IN')} credits</TextBlock>
            </View>
            <Card style={{ gap: 8 }}>
              <KeyValue label="Credits" value={checkout.toLocaleString('en-IN')} />
              <Divider />
              <KeyValue label="Price per credit" value={rupees(1)} />
              <Divider />
              <KeyValue label="Wallet balance after payment" value={wallet ? `${(wallet.balance + checkout).toLocaleString('en-IN')} credits` : '—'} />
              <Divider />
              <KeyValue label="Total payable" value={rupees(checkout)} strong />
            </Card>
            <View style={{ gap: 12 }}>
              {TRUST.map((item) => (
                <View key={item.title} style={styles.trust}>
                  <View style={[styles.trustIcon, { backgroundColor: colors.successBackground }]}><Feather name={item.icon} size={15} color={colors.successForeground} /></View>
                  <View style={{ flex: 1, gap: 1 }}>
                    <TextBlock size={13} weight="semibold">{item.title}</TextBlock>
                    <TextBlock size={12} color={colors.mutedForeground}>{item.body}</TextBlock>
                  </View>
                </View>
              ))}
            </View>
          </View>
        ) : null}
      </Sheet>
    </View>
  );
}

/** Why the payment is safe, shown on the checkout sheet. */
const TRUST: { icon: keyof typeof Feather.glyphMap; title: string; body: string }[] = [
  { icon: 'shield', title: 'Secured by Razorpay', body: 'Pay with UPI, card or net banking on Razorpay’s PCI DSS compliant checkout.' },
  { icon: 'lock', title: 'Your details stay private', body: 'We never see or store your card number, bank login or UPI PIN.' },
  { icon: 'zap', title: 'Credits added instantly', body: 'Credits reach your wallet as soon as the payment succeeds and never expire.' },
  { icon: 'file-text', title: 'Invoice for every payment', body: 'Kept in Wallet → Billing invoices and sent to your email.' },
];

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
  confirming: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  amount: { borderRadius: 16, padding: 16, alignItems: 'center', gap: 2 },
  trust: { flexDirection: 'row', alignItems: 'flex-start', gap: 11 },
  trustIcon: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  quickAdd: { gap: 10, marginTop: 10 },
  quickPacks: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  quickInput: { borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 16, fontWeight: '600' },
  quickPack: { flexGrow: 1, flexBasis: '30%', borderWidth: 1, borderRadius: 12, paddingVertical: 7, alignItems: 'center', gap: 1 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  stat: { flexBasis: '47%', flexGrow: 1 },
  packs: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  pack: { flexBasis: '30%', flexGrow: 1, borderWidth: 1, borderRadius: 16, padding: 12, gap: 2, alignItems: 'center' },
});

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Image, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card, Chip, ChipRow, Divider, EmptyState, Field, KeyValue, ListRow, Notice, ScreenHeader, SectionTitle, Sheet, StatusPill, TextBlock, type Tone } from '@/components/AppUI';
import { useDialog } from '@/components/Dialog';
import { useColors } from '@/hooks/useColors';
import { usePdfActions } from '@/hooks/usePdfActions';
import { api, ApiError, type BillingInvoice, type CreditPurchase } from '@/lib/api';
import { formatDate } from '@/lib/domain';
import { useAppStore } from '@/state/app-store';

const GOLD = '#f2b230';
/** Brand green, the same in light and dark mode (white text on it stays readable). */
const BRAND = '#175b42';
const inr = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const monthOf = (iso: string) => new Date(Date.parse(iso) + 330 * 60_000).toISOString().slice(0, 7);
const monthLabel = (month: string) => new Date(`${month}-01T00:00:00+05:30`).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });
const day = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });

const PAYMENT_STATUS: Record<CreditPurchase['status'], { label: string; tone: Tone }> = {
  paid: { label: 'Paid', tone: 'green' },
  created: { label: 'Pending', tone: 'amber' },
  expired: { label: 'Expired', tone: 'neutral' },
  cancelled: { label: 'Cancelled', tone: 'red' },
};

/** Invoices for credit purchases (date-wise, searchable) and the full payment history. */
export default function BillingScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const workspaceId = useAppStore().workspaceId;
  const [data, setData] = useState<{ invoices: BillingInvoice[]; payments: CreditPurchase[] } | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [month, setMonth] = useState<string | null>(null);
  const [open, setOpen] = useState<BillingInvoice | null>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      setData(await api.billingInvoices());
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not load your invoices. Check your connection.');
    }
  }, []);
  // After a cold start the account ID arrives a moment later; load once it is there.
  useEffect(() => {
    if (workspaceId) void load();
  }, [load, workspaceId]);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const invoices = data?.invoices ?? [];
  const months = useMemo(() => [...new Set(invoices.map((invoice) => monthOf(invoice.paidAt)))], [invoices]);
  const query = search.trim().toLowerCase();
  const shown = invoices.filter((invoice) =>
    (!month || monthOf(invoice.paidAt) === month) &&
    (!query || [invoice.number, invoice.paymentId ?? '', String(invoice.credits), (invoice.amountPaise / 100).toFixed(2), day(invoice.paidAt)].some((value) => value.toLowerCase().includes(query))));
  const groups = shown.reduce<{ month: string; items: BillingInvoice[] }[]>((list, invoice) => {
    const key = monthOf(invoice.paidAt);
    const last = list[list.length - 1];
    if (last?.month === key) last.items.push(invoice);
    else list.push({ month: key, items: [invoice] });
    return list;
  }, []);
  const totalPaise = invoices.reduce((sum, invoice) => sum + invoice.amountPaise, 0);
  const totalCredits = invoices.reduce((sum, invoice) => sum + invoice.credits, 0);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader title="Billing invoices" subtitle="Your payments and invoices" />
      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 30 }]} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />} keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          <View style={styles.heroTop}>
            <Image source={require('@/assets/images/icon.png')} style={styles.heroLogo} />
            <View style={{ flex: 1 }}>
              <TextBlock size={17} weight="bold" color="#fff">E-Way <TextBlock size={17} weight="bold" color={GOLD}>Easy</TextBlock></TextBlock>
              <TextBlock size={11} color="#d6e7de">Billing invoices</TextBlock>
            </View>
          </View>
          <View style={styles.heroStats}>
            <View style={{ flex: 1 }}>
              <TextBlock size={11} color="#d6e7de">TOTAL PAID</TextBlock>
              <TextBlock size={22} weight="bold" color="#fff">{data ? inr(totalPaise) : '—'}</TextBlock>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <TextBlock size={11} color="#d6e7de">INVOICES</TextBlock>
              <TextBlock size={22} weight="bold" color={GOLD}>{data ? invoices.length : '—'}</TextBlock>
            </View>
          </View>
          <TextBlock size={11} color="#d6e7de">{data ? `${totalCredits.toLocaleString('en-IN')} credits bought` : 'Loading…'}</TextBlock>
        </View>

        {error ? <Notice tone="warning" title="Check this" body={error} action="Try again" onAction={() => void load()} /> : null}

        <Field label="Find an invoice" value={search} onChangeText={setSearch} placeholder="Invoice no., payment ID, amount or date" autoCapitalize="none" testID="billing-search" />
        {months.length > 1 ? (
          <ChipRow>
            <Chip label="All" icon="calendar" selected={!month} onPress={() => setMonth(null)} />
            {months.map((item) => <Chip key={item} label={monthLabel(item)} selected={month === item} onPress={() => setMonth(item)} />)}
          </ChipRow>
        ) : null}

        {!data && !error ? (
          <Card><TextBlock size={13} color={colors.mutedForeground}>Loading your invoices…</TextBlock></Card>
        ) : groups.length ? groups.map((group) => (
          <View key={group.month} style={{ gap: 8 }}>
            <SectionTitle title={monthLabel(group.month)} count={group.items.length} />
            <Card style={{ padding: 0, gap: 0 }}>
              {group.items.map((invoice, index) => (
                <React.Fragment key={invoice.purchaseId}>
                  {index ? <Divider inset={64} /> : null}
                  <ListRow
                    icon="file-text"
                    title={invoice.number}
                    detail={`${day(invoice.paidAt)} · ${invoice.credits.toLocaleString('en-IN')} credits`}
                    onPress={() => setOpen(invoice)}
                    right={<TextBlock weight="bold" color={colors.primary}>{inr(invoice.amountPaise)}</TextBlock>}
                    testID={`billing-invoice-${invoice.number}`}
                  />
                </React.Fragment>
              ))}
            </Card>
          </View>
        )) : data ? (
          <Card><EmptyState icon="file-text" title={query || month ? 'No matching invoice' : 'No invoices yet'} body={query || month ? 'Try another invoice number, amount or month.' : 'When you buy credits, the invoice appears here and is emailed to you.'} /></Card>
        ) : null}

        {data?.payments.length ? (
          <>
            <SectionTitle title="Payment history" count={data.payments.length} />
            <Card style={{ padding: 0, gap: 0 }}>
              {data.payments.map((payment, index) => {
                const status = PAYMENT_STATUS[payment.status];
                return (
                  <React.Fragment key={payment.id}>
                    {index ? <Divider inset={64} /> : null}
                    <ListRow
                      icon={payment.status === 'paid' ? 'check-circle' : payment.status === 'created' ? 'clock' : 'x-circle'}
                      title={`${inr(payment.amountPaise)} · ${payment.credits.toLocaleString('en-IN')} credits`}
                      detail={[formatDate(payment.paidAt ?? payment.createdAt, true), payment.invoiceNumber, payment.paymentId].filter(Boolean).join(' · ')}
                      right={<StatusPill label={status.label} tone={status.tone} />}
                      onPress={payment.invoiceNumber ? () => setOpen(invoices.find((invoice) => invoice.purchaseId === payment.id) ?? null) : undefined}
                    />
                  </React.Fragment>
                );
              })}
            </Card>
          </>
        ) : null}
      </ScrollView>
      <InvoiceSheet invoice={open} onClose={() => setOpen(null)} />
    </View>
  );
}

/** One invoice: summary in the app's colors, with Download, Share and Email. */
function InvoiceSheet({ invoice, onClose }: { invoice: BillingInvoice | null; onClose: () => void }) {
  const colors = useColors();
  const dialog = useDialog();
  const pdf = usePdfActions();
  const [busy, setBusy] = useState<'download' | 'share' | 'email' | null>(null);

  const withHtml = async (kind: 'download' | 'share') => {
    if (!invoice) return;
    setBusy(kind);
    try {
      const { html } = await api.billingInvoice(invoice.purchaseId);
      await pdf[kind](html, `Invoice ${invoice.number}`);
    } catch (caught) {
      dialog.toast(caught instanceof ApiError ? caught.message : 'Could not open the invoice.', 'danger');
    } finally {
      setBusy(null);
    }
  };

  const email = async () => {
    if (!invoice) return;
    setBusy('email');
    try {
      const sent = await api.emailBillingInvoice(invoice.purchaseId);
      dialog.toast(`Invoice sent to ${sent.emailedTo}`, 'success');
    } catch (caught) {
      dialog.toast(caught instanceof ApiError ? caught.message : 'Could not send the email.', 'danger');
    } finally {
      setBusy(null);
    }
  };

  const buyer = invoice?.buyer;
  return (
    <Sheet
      visible={Boolean(invoice)}
      onClose={onClose}
      title={invoice?.number ?? ''}
      subtitle={invoice ? `Paid on ${formatDate(invoice.paidAt, true)}` : undefined}
      footer={invoice ? (
        <View style={{ gap: 10 }}>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button title="Download" icon="download" onPress={() => void withHtml('download')} loading={busy === 'download'} disabled={busy !== null} style={{ flex: 1 }} testID="billing-download" />
            <Button title="Share" icon="share-2" variant="outline" onPress={() => void withHtml('share')} loading={busy === 'share'} disabled={busy !== null} style={{ flex: 1 }} testID="billing-share" />
          </View>
          <Button title="Email me this invoice" icon="mail" variant="ghost" onPress={() => void email()} loading={busy === 'email'} disabled={busy !== null} />
        </View>
      ) : undefined}
    >
      {invoice && buyer ? (
        <View style={{ gap: 12 }}>
          <View style={styles.invoiceHead}>
            <Image source={require('@/assets/images/icon.png')} style={styles.invoiceLogo} />
            <View style={{ flex: 1 }}>
              <TextBlock size={16} weight="bold" color="#fff">E-Way <TextBlock size={16} weight="bold" color={GOLD}>Easy</TextBlock></TextBlock>
              <TextBlock size={11} color="#d6e7de">Rajkot, Gujarat, India</TextBlock>
            </View>
            <View style={[styles.paid, { backgroundColor: GOLD }]}><Feather name="check" size={12} color="#1b2420" /><TextBlock size={11} weight="bold" color="#1b2420">PAID</TextBlock></View>
          </View>
          <View style={[styles.total, { backgroundColor: colors.accent }]}>
            <TextBlock size={12} color={colors.accentForeground}>Total paid</TextBlock>
            <TextBlock size={26} weight="bold" color={colors.accentForeground}>{inr(invoice.amountPaise)}</TextBlock>
            <TextBlock size={12} color={colors.accentForeground}>{invoice.credits.toLocaleString('en-IN')} credits × {inr(invoice.ratePaise)}</TextBlock>
          </View>
          <Card style={{ gap: 8 }}>
            <TextBlock size={11} weight="bold" color={colors.mutedForeground}>BILLED TO</TextBlock>
            <TextBlock size={15} weight="bold">{buyer.name || 'E-Way Easy customer'}</TextBlock>
            {buyer.gstin ? <TextBlock size={12} color={colors.mutedForeground}>GSTIN: {buyer.gstin}</TextBlock> : null}
            {[buyer.address, [buyer.state, buyer.pincode].filter(Boolean).join(' - ')].filter(Boolean).map((line) => <TextBlock key={line} size={12} color={colors.mutedForeground}>{line}</TextBlock>)}
          </Card>
          <Card style={{ gap: 8 }}>
            <KeyValue label="Invoice no." value={invoice.number} strong />
            <Divider />
            <KeyValue label="Date" value={formatDate(invoice.paidAt, true)} />
            <Divider />
            <KeyValue label="Method" value={invoice.provider === 'razorpay' ? 'Online · Razorpay' : 'Test purchase'} />
            {invoice.paymentId ? <><Divider /><KeyValue label="Payment ID" value={invoice.paymentId} mono /></> : null}
            {invoice.emailedTo ? <><Divider /><KeyValue label="Emailed to" value={invoice.emailedTo} /></> : null}
          </Card>
        </View>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 14, maxWidth: 720, width: '100%', alignSelf: 'center' },
  hero: { backgroundColor: BRAND, borderRadius: 20, padding: 16, gap: 12, borderBottomWidth: 4, borderBottomColor: GOLD },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  heroLogo: { width: 40, height: 40, borderRadius: 10 },
  heroStats: { flexDirection: 'row', alignItems: 'flex-end' },
  invoiceHead: { backgroundColor: BRAND, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 16, padding: 14, borderBottomWidth: 4, borderBottomColor: GOLD },
  invoiceLogo: { width: 40, height: 40, borderRadius: 10 },
  paid: { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
  total: { borderRadius: 16, padding: 14, gap: 2, alignItems: 'center' },
});

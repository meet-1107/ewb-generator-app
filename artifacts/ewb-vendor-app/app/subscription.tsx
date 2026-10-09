import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card, KeyValue, Notice, ScreenHeader, Skeleton, StatusPill, TextBlock } from '@/components/AppUI';
import { useDialog } from '@/components/Dialog';
import { useColors } from '@/hooks/useColors';
import { api, ApiError, type Plan } from '@/lib/api';
import { formatDate, formatInr, periodLabel } from '@/lib/domain';
import { useAppStore } from '@/state/app-store';

export default function SubscriptionScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const store = useAppStore();
  const dialog = useDialog();
  const [changing, setChanging] = useState<string | null>(null);
  const data = store.subscription;

  useEffect(() => {
    void store.refreshSubscription();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const choose = async (plan: Plan) => {
    if (!data || plan.id === data.plan.id) return;
    const sandbox = data.billingMode === 'sandbox';
    const ok = await dialog.confirm({
      title: `Switch to ${plan.name}?`,
      message: sandbox
        ? `Sandbox billing: no payment is taken. In production this opens the ${'App Store / Google Play'} purchase sheet and shows the final price including GST.`
        : `${plan.pricePaise ? `${formatInr(plan.pricePaise)} per ${plan.cadence} + GST.` : 'Free plan.'} You can change plans anytime.`,
      confirmLabel: plan.pricePaise > data.plan.pricePaise ? 'Upgrade' : 'Switch plan',
      icon: 'trending-up',
    });
    if (!ok) return;
    setChanging(plan.id);
    try {
      await api.changePlan(plan.id);
      await store.refreshSubscription();
      dialog.toast(`You're on ${plan.name}`, 'success');
    } catch (error) {
      await dialog.alert({ title: 'Plan not changed', message: error instanceof ApiError ? error.message : 'Check your connection and try again.', tone: 'danger' });
    } finally {
      setChanging(null);
    }
  };

  const usage = data ? data.subscription.usageCount : 0;
  const limit = data?.plan.ewbLimit ?? null;
  const pct = limit ? Math.min(1, usage / limit) : 0;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader title="Plan & usage" />
      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 30 }]}>
        {!data ? (
          store.online === false ? <Notice tone="warning" title="Offline" body="Connect to view your plan. Your invoices and bills stay available." /> : <Card><Skeleton width="40%" /><Skeleton /><Skeleton width="70%" /></Card>
        ) : (
          <>
            {data.plansAreSamples ? <Notice tone="warning" title="Sample plans" body="Prices, limits and trial terms are placeholders until billing is approved. No payment is collected in sandbox mode." /> : null}
            {data.subscription.entitlementState === 'expired' ? <Notice tone="danger" title="Plan expired" body="You can still view, print and export every invoice and bill. Renew to generate new e-way bills." /> : null}
            <Card>
              <View style={styles.row}>
                <View style={{ flex: 1, gap: 2 }}>
                  <TextBlock size={12} color={colors.mutedForeground}>CURRENT PLAN</TextBlock>
                  <TextBlock size={24} weight="bold">{data.plan.name}</TextBlock>
                </View>
                <StatusPill label={data.subscription.entitlementState === 'trial' ? 'Free trial' : data.subscription.entitlementState} tone={data.subscription.entitlementState === 'expired' ? 'red' : 'green'} />
              </View>
              <View style={{ gap: 7 }}>
                <View style={styles.row}>
                  <TextBlock size={13} weight="semibold" style={{ flex: 1 }}>E-way bills · {periodLabel(data.subscription.usagePeriod)}</TextBlock>
                  <TextBlock size={13} weight="bold">{usage} / {limit ?? '∞'}</TextBlock>
                </View>
                <View style={[styles.meter, { backgroundColor: colors.muted }]}><View style={[styles.fill, { width: `${(limit ? pct : 0.04) * 100}%`, backgroundColor: pct > 0.85 ? colors.destructive : colors.primary }]} /></View>
                {limit && pct >= 0.8 ? <TextBlock size={12} color={colors.dangerForeground}>{limit - usage} left this month — upgrade to avoid interruptions.</TextBlock> : null}
              </View>
              <KeyValue label={data.subscription.entitlementState === 'trial' ? 'Trial ends' : 'Renews'} value={formatDate(data.subscription.renewalAt)} />
              <KeyValue label="Billing" value={data.billingMode === 'sandbox' ? 'Sandbox (no charges)' : data.billingMode} />
            </Card>

            <TextBlock size={18} weight="semibold">Compare plans</TextBlock>
            {data.plans.map((plan) => {
              const current = plan.id === data.plan.id;
              return (
                <Card key={plan.id} style={current ? { borderColor: colors.primary, borderWidth: 2 } : undefined}>
                  <View style={styles.row}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <TextBlock size={17} weight="bold">{plan.name}</TextBlock>
                      <TextBlock size={13} color={colors.mutedForeground}>{plan.pricePaise ? `${formatInr(plan.pricePaise)} / ${plan.cadence} + GST` : 'Free'}</TextBlock>
                    </View>
                    {current ? <StatusPill label="Current" tone="green" icon="check" /> : plan.id === 'growth' ? <StatusPill label="Popular" tone="amber" /> : null}
                  </View>
                  <View style={{ gap: 7 }}>
                    {plan.features.map((feature) => (
                      <View key={feature} style={styles.feature}><Feather name="check" size={15} color={colors.primary} /><TextBlock size={13}>{feature}</TextBlock></View>
                    ))}
                  </View>
                  {!current ? <Button title={plan.pricePaise > data.plan.pricePaise ? `Upgrade to ${plan.name}` : `Switch to ${plan.name}`} variant={plan.pricePaise > data.plan.pricePaise ? 'primary' : 'outline'} onPress={() => void choose(plan)} loading={changing === plan.id} disabled={Boolean(changing)} /> : null}
                </Card>
              );
            })}

            {data.subscription.billingHistory.length ? (
              <Card>
                <TextBlock size={15} weight="semibold">Billing history</TextBlock>
                {data.subscription.billingHistory.slice(0, 6).map((item) => (
                  <KeyValue key={item.reference} label={`${formatDate(item.at)} · ${data.plans.find((plan) => plan.id === item.planId)?.name ?? item.planId}`} value={`${formatInr(item.amountPaise)} · ${item.reference}`} />
                ))}
              </Card>
            ) : null}
            <TextBlock size={11} color={colors.mutedForeground} style={{ textAlign: 'center', lineHeight: 17 }}>Plan access is enforced by our servers. If a plan lapses, nothing is deleted — your records stay readable and exportable.</TextBlock>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 14, maxWidth: 720, width: '100%', alignSelf: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  meter: { height: 10, borderRadius: 5, overflow: 'hidden' },
  fill: { height: 10, borderRadius: 5 },
  feature: { flexDirection: 'row', alignItems: 'center', gap: 9 },
});

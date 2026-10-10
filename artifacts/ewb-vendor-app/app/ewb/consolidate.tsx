import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card, Checkbox, Divider, EmptyState, Field, KeyValue, Notice, ScreenHeader, SectionTitle, SelectField, TextBlock } from '@/components/AppUI';
import { useDialog } from '@/components/Dialog';
import { useColors } from '@/hooks/useColors';
import { useCredits } from '@/hooks/useCredits';
import { api, ApiError, type CewbRecord } from '@/lib/api';
import { formatDate, formatInr, liveEwbStatus, STATES, VEHICLE_PATTERN } from '@/lib/domain';
import { useAppStore, useScopedRecords } from '@/state/app-store';

const stateOptions = STATES.map((state) => ({ value: state.name, label: state.name }));

/** Consolidated e-way bill: one vehicle carrying several active bills. */
export default function ConsolidateScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const store = useAppStore();
  const dialog = useDialog();
  const credits = useCredits();
  const { ewbs } = useScopedRecords();
  const params = useLocalSearchParams<{ ids?: string }>();
  const [selected, setSelected] = useState<string[]>(() => (params.ids ? params.ids.split(',').filter(Boolean) : []));
  const [vehicle, setVehicle] = useState('');
  const [place, setPlace] = useState('');
  const [state, setState] = useState(store.business?.state ?? '');
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<CewbRecord | null>(null);
  const [history, setHistory] = useState<CewbRecord[]>([]);

  const eligible = useMemo(
    () => ewbs.filter((ewb) => !ewb.consolidatedInto && ['active', 'part_b_pending'].includes(liveEwbStatus(ewb))),
    [ewbs],
  );

  useEffect(() => {
    if (!store.workspaceId) return;
    api.listConsolidated().then((result) => setHistory(result.cewbs)).catch(() => undefined);
  }, [created, store.workspaceId]);

  const toggle = (id: string) => setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  const vehicleNumber = vehicle.replace(/[\s-]/g, '').toUpperCase();

  const submit = async () => {
    if (!selected.length) return dialog.toast('Choose at least one e-way bill', 'danger');
    if (!VEHICLE_PATTERN.test(vehicleNumber)) return dialog.toast('Vehicle number format looks wrong (e.g. MH12AB1234).', 'danger');
    if (!place.trim()) return dialog.toast('Enter the place the vehicle starts from', 'danger');
    if (!state) return dialog.toast('Choose the state the vehicle starts from', 'danger');
    const ok = await credits.confirmSpend('consolidate', `A consolidated e-way bill for ${selected.length} bill${selected.length === 1 ? '' : 's'}`);
    if (!ok) return;
    setBusy(true);
    try {
      const result = await api.consolidate({ ewbIds: selected, vehicleNumber, fromPlace: place.trim(), fromState: state });
      store.setWalletBalance(result.balance);
      setCreated(result.cewb);
      setSelected([]);
      dialog.toast(`Consolidated e-way bill ${result.cewb.cewbNumber} created`, 'success');
      void store.refreshEwbs();
      void store.refreshWallet();
    } catch (error) {
      if (!(await credits.handleError(error))) {
        await dialog.alert({ title: 'Could not consolidate', message: error instanceof ApiError ? error.message : 'Check your connection and try again.', tone: 'danger' });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader title="Consolidate e-way bills" subtitle="One vehicle, several consignments" />
      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 30 }]} keyboardShouldPersistTaps="handled">
        {created ? (
          <Card>
            <TextBlock size={12} weight="bold" color={colors.mutedForeground}>CONSOLIDATED E-WAY BILL</TextBlock>
            <TextBlock size={26} weight="bold">{created.cewbNumber}</TextBlock>
            <KeyValue label="Vehicle" value={created.vehicleNumber} />
            <KeyValue label="From" value={`${created.fromPlace}, ${created.fromState}`} />
            <KeyValue label="Bills" value={created.ewbNumbers.join(', ')} mono />
            <Button title="Back to e-way bills" variant="outline" onPress={() => router.replace('/(tabs)/ewbs')} />
          </Card>
        ) : null}

        <SectionTitle title="Choose bills" count={eligible.length} />
        {eligible.length ? (
          <Card style={{ gap: 10 }}>
            {eligible.map((ewb, index) => (
              <React.Fragment key={ewb.id}>
                {index ? <Divider /> : null}
                <Checkbox
                  checked={selected.includes(ewb.id)}
                  onToggle={() => toggle(ewb.id)}
                  label={`${ewb.ewbNumber} · ${ewb.buyerName} · ${formatInr(ewb.totals.total)} · valid till ${formatDate(ewb.validUntil)}`}
                />
              </React.Fragment>
            ))}
          </Card>
        ) : (
          <Card><EmptyState icon="layers" title="No bills to consolidate" body="Only active e-way bills that are not already in a consolidated bill can be added." /></Card>
        )}

        <SectionTitle title="Vehicle & starting point" />
        <Card>
          <Field label="Vehicle number" required value={vehicle} onChangeText={(value) => setVehicle(value.toUpperCase())} placeholder="MH12AB1234" autoCapitalize="characters" maxLength={12} />
          <Field label="From place" required value={place} onChangeText={setPlace} placeholder="City or town" autoCapitalize="words" maxLength={50} />
          <SelectField label="From state" required value={state} placeholder="Choose state" options={stateOptions} onSelect={setState} />
        </Card>

        <Notice title={`Uses ${credits.costs.consolidate} credits`} body={`Balance: ${credits.balance ?? '—'} credits. Refunded automatically if the portal rejects it.`} />
        <Button title={`Create consolidated bill${selected.length ? ` (${selected.length})` : ''}`} icon="layers" onPress={() => void submit()} loading={busy} disabled={!selected.length || store.online === false} />

        {history.length ? (
          <>
            <SectionTitle title="Earlier consolidated bills" count={history.length} />
            <Card>
              {history.map((cewb, index) => (
                <React.Fragment key={cewb.id}>
                  {index ? <Divider /> : null}
                  <KeyValue label={`${cewb.cewbNumber} · ${formatDate(cewb.generatedAt, true)}`} value={`${cewb.vehicleNumber} · ${cewb.ewbNumbers.length} bill${cewb.ewbNumbers.length === 1 ? '' : 's'}`} />
                </React.Fragment>
              ))}
            </Card>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 14, maxWidth: 720, width: '100%', alignSelf: 'center' },
});

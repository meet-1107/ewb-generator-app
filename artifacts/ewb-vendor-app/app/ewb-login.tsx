import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card, Divider, Field, ListRow, Notice, ScreenHeader, Sheet, StatusPill, TextBlock } from '@/components/AppUI';
import { useDialog } from '@/components/Dialog';
import { useColors } from '@/hooks/useColors';
import { api, ApiError, type EwbCredential } from '@/lib/api';
import { formatDate, gstinProblem } from '@/lib/domain';
import { useAppStore } from '@/state/app-store';

/**
 * E-way bill portal API login per GSTIN. The password goes to the server,
 * which stores it encrypted and uses it only to call the e-way bill system.
 */
export default function EwbLoginScreen() {
  const params = useLocalSearchParams<{ gstin?: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const store = useAppStore();
  const dialog = useDialog();
  const [saved, setSaved] = useState<EwbCredential[]>([]);
  const [required, setRequired] = useState(true);
  const [canStore, setCanStore] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [newGstin, setNewGstin] = useState('');
  const [busy, setBusy] = useState(false);

  const gstins = useMemo(() => {
    const list = new Set<string>();
    if (store.business?.gstin) list.add(store.business.gstin);
    for (const registration of store.business?.gstRegistrations ?? []) list.add(registration.gstin);
    for (const credential of saved) list.add(credential.gstin);
    return [...list];
  }, [saved, store.business]);

  const load = useCallback(async () => {
    try {
      const result = await api.ewbCredentials();
      setSaved(result.credentials);
      setRequired(result.required);
      setCanStore(result.canStore);
    } catch (error) {
      dialog.toast(error instanceof ApiError ? error.message : 'Could not load saved logins', 'danger');
    } finally {
      setLoaded(true);
    }
  }, [dialog]);

  useEffect(() => {
    void load();
  }, [load]);

  const open = (gstin: string) => {
    setEditing(gstin);
    setUsername(saved.find((item) => item.gstin === gstin)?.username ?? '');
    setPassword('');
  };

  useEffect(() => {
    if (loaded && params.gstin && !gstinProblem(params.gstin)) open(params.gstin);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, params.gstin]);

  const save = async () => {
    if (!editing) return;
    const gstin = editing === 'new' ? newGstin.trim().toUpperCase() : editing;
    if (gstinProblem(gstin)) return dialog.toast(gstinProblem(gstin)!, 'danger');
    if (!username.trim() || !password) return dialog.toast('Enter the API username and password.', 'danger');
    setBusy(true);
    try {
      await api.saveEwbCredential(gstin, username.trim(), password);
      dialog.toast('Login saved securely', 'success');
      setEditing(null);
      setNewGstin('');
      await load();
    } catch (error) {
      dialog.toast(error instanceof ApiError ? error.message : 'Could not save', 'danger');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (gstin: string) => {
    const ok = await dialog.confirm({ title: `Remove login for ${gstin}?`, message: 'E-way bills for this GSTIN cannot be generated until you add it again.', confirmLabel: 'Remove', tone: 'danger', icon: 'trash-2' });
    if (!ok) return;
    await api.deleteEwbCredential(gstin).catch(() => undefined);
    setEditing(null);
    await load();
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader title="E-way bill portal login" subtitle="API username & password per GSTIN" />
      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 30 }]} keyboardShouldPersistTaps="handled">
        {!required && loaded ? <Notice title="Not needed right now" body="The server is using the sandbox provider, which does not need a portal login." /> : null}
        {!canStore ? <Notice tone="warning" title="Server setup needed" body="The server cannot store passwords securely yet (EWB_CREDENTIALS_SECRET is not set)." /> : null}
        <Card>
          <TextBlock size={13} color={colors.mutedForeground}>
            To generate e-way bills from this app, create API credentials once on ewaybillgst.gov.in → Registration → For GSP, choosing the GSP named in gstinapi.in's setup guide. These are different from your normal portal login.
          </TextBlock>
        </Card>
        <Card style={{ padding: 0, gap: 0 }}>
          {gstins.map((gstin, index) => {
            const credential = saved.find((item) => item.gstin === gstin);
            return (
              <React.Fragment key={gstin}>
                {index ? <Divider inset={64} /> : null}
                <ListRow
                  icon="key"
                  title={gstin}
                  detail={credential ? `${credential.username} · saved ${formatDate(credential.updatedAt)}` : 'No login saved'}
                  right={<StatusPill label={credential ? 'Saved' : 'Missing'} tone={credential ? 'green' : 'amber'} />}
                  onPress={() => open(gstin)}
                />
              </React.Fragment>
            );
          })}
          {gstins.length ? <Divider /> : null}
          <ListRow icon="plus" title="Add another GSTIN" onPress={() => open('new')} />
        </Card>
      </ScrollView>

      <Sheet
        visible={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'Add portal login' : `Login for ${editing}`}
        footer={<View style={{ flexDirection: 'row', gap: 10 }}>
          {editing && editing !== 'new' && saved.some((item) => item.gstin === editing) ? <Button title="Remove" variant="danger" onPress={() => void remove(editing)} style={{ flex: 1 }} /> : null}
          <Button title="Save" onPress={() => void save()} loading={busy} style={{ flex: 2 }} />
        </View>}
      >
        <View style={{ paddingHorizontal: 18, gap: 12 }}>
          {editing === 'new' ? <Field label="GSTIN" required value={newGstin} onChangeText={(value) => setNewGstin(value.toUpperCase().replace(/\s/g, ''))} autoCapitalize="characters" maxLength={15} /> : null}
          <Field label="API username" required value={username} onChangeText={setUsername} autoCapitalize="none" />
          <Field label="API password" required value={password} onChangeText={setPassword} secureTextEntry hint="Stored encrypted on the server; never shown again." />
        </View>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 14, maxWidth: 720, width: '100%', alignSelf: 'center' },
});

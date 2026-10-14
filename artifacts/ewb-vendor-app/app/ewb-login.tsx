import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card, Divider, Field, ListRow, Notice, ScreenHeader, Sheet, StatusPill, TextBlock } from '@/components/AppUI';
import { useDialog } from '@/components/Dialog';
import { EWB_PORTAL_URL, EwbLoginSteps, useTutorialVideo } from '@/components/EwbLoginGuide';
import { useColors } from '@/hooks/useColors';
import { api, ApiError, type EwbCredential } from '@/lib/api';
import { formatDate, gstinProblem } from '@/lib/domain';
import { useAppStore } from '@/state/app-store';

/**
 * E-way bill portal API login per GSTIN. The password goes to the server,
 * which stores it encrypted and uses it only to call the e-way bill system.
 */
export default function EwbLoginScreen() {
  const params = useLocalSearchParams<{ gstin?: string; from?: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const store = useAppStore();
  const dialog = useDialog();
  const [saved, setSaved] = useState<EwbCredential[]>([]);
  const [required, setRequired] = useState(true);
  const [provider, setProvider] = useState<'live' | 'test' | 'none' | undefined>();
  const [canStore, setCanStore] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [newGstin, setNewGstin] = useState('');
  const [busy, setBusy] = useState(false);
  const video = useTutorialVideo();

  const gstins = useMemo(() => {
    const list = new Set<string>();
    if (store.business?.gstin) list.add(store.business.gstin);
    for (const registration of store.business?.gstRegistrations ?? []) list.add(registration.gstin);
    for (const credential of saved) list.add(credential.gstin);
    return [...list];
  }, [saved, store.business]);

  const load = useCallback(async () => {
    if (!store.workspaceId) return;
    try {
      const result = await api.ewbCredentials();
      setSaved(result.credentials);
      setRequired(result.required);
      setProvider(result.provider);
      setCanStore(result.canStore);
    } catch (error) {
      dialog.toast(error instanceof ApiError ? error.message : 'Could not load saved logins', 'danger');
    } finally {
      setLoaded(true);
    }
  }, [dialog, store.workspaceId]);

  // Waits for the account to be ready (a deep link can open this screen first).
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
      const result = await api.saveEwbCredential(gstin, username.trim(), password);
      dialog.toast(result.checked ? 'Login checked with the portal and saved' : result.message || 'Login saved securely', result.checked ? 'success' : 'default');
      setEditing(null);
      setNewGstin('');
      // Opened from the first e-way bill: back to it, Generate is now unlocked.
      if (params.from === 'ewb' && router.canGoBack()) return router.back();
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
      <KeyboardAwareScrollViewCompat contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 30 }]} keyboardShouldPersistTaps="handled">
        {loaded && provider === 'none' ? <Notice tone="warning" title="E-way bill generation is not switched on yet" body="The server has no e-way bill provider connected (its gstinapi.in key is missing). Your saved login is kept and is checked automatically once it is switched on." /> : null}
        {loaded && provider !== 'none' && !required ? <Notice title="Not needed right now" body="The server is using the sandbox provider, which does not need a portal login." /> : null}
        {loaded && provider === 'test' && required ? <Notice tone="warning" title="Test mode" body="Bills are checked by gstinapi.in but not filed with NIC. Ask the app owner to switch to live mode." /> : null}
        {!canStore ? <Notice tone="warning" title="Server setup needed" body="The server cannot store passwords securely yet (EWB_CREDENTIALS_SECRET is not set)." /> : null}
        <Card style={{ gap: 14 }}>
          <TextBlock size={15} weight="semibold">How to create the API login</TextBlock>
          <TextBlock size={12} color={colors.mutedForeground}>One-time setup for each GSTIN. The API login is different from your normal portal login.</TextBlock>
          <EwbLoginSteps />
          <View style={{ gap: 10 }}>
            <Button title="Watch setup video" icon="play-circle" onPress={() => void video.open()} testID="ewb-login-video" />
            <Button title="Open e-way bill portal" icon="external-link" variant="outline" onPress={() => void Linking.openURL(EWB_PORTAL_URL)} />
          </View>
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
      </KeyboardAwareScrollViewCompat>

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

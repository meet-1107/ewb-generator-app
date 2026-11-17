import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Linking, Modal, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import { Button, Divider, Field, IconButton, ListRow, Segmented, SelectField, Sheet, TextBlock } from '@/components/AppUI';
import { useDialog } from '@/components/Dialog';
import { router } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { useSupportUnread } from '@/state/support';
import { SUPPORT_EMAIL } from '@/lib/api';
import { relativeTime, STATES, type Business } from '@/lib/domain';
import { useAppStore } from '@/state/app-store';
import { useAuth } from '@/state/auth';
import { setThemePreference, useThemePreference, type ThemePreference } from '@/state/theme';

const stateOptions = STATES.map((state) => ({ value: state.name, label: state.name }));

type EditMode = 'profile' | 'contact';

/**
 * The left panel (menu button on the dashboard): business profile, contact
 * details and preferences, each editable from here.
 */
export function SideMenu({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const auth = useAuth();
  const store = useAppStore();
  const dialog = useDialog();
  const theme = useThemePreference();
  const supportUnread = useSupportUnread(visible);
  const panelWidth = Math.min(340, Math.round(width * 0.86));
  const slide = useRef(new Animated.Value(0)).current;
  const [shown, setShown] = useState(visible);
  const [editing, setEditing] = useState<EditMode | null>(null);
  const [form, setForm] = useState<Business | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (visible) setShown(true);
    Animated.timing(slide, { toValue: visible ? 1 : 0, duration: visible ? 230 : 180, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(({ finished }) => {
      if (finished && !visible) setShown(false);
    });
  }, [visible, slide]);

  const business = store.business;
  const name = auth.user?.displayName || (auth.previewMode ? 'Preview workspace' : auth.user?.email) || 'Your account';
  const initials = (business?.name || name).split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();

  const edit = (mode: EditMode) => {
    setForm(store.business);
    setErrors({});
    onClose();
    // The panel closes first, so the sheet is not stacked over it.
    setTimeout(() => setEditing(mode), 200);
  };

  const save = async () => {
    if (!form || !business) return;
    const problems: Record<string, string> = {};
    if (!form.name.trim()) problems.name = 'Business name is required.';
    if (form.pincode && !/^[1-9]\d{5}$/.test(form.pincode)) problems.pincode = 'PIN code must be 6 digits.';
    if (form.email && !/^\S+@\S+\.\S+$/.test(form.email.trim())) problems.email = 'Enter a valid email.';
    setErrors(problems);
    if (Object.keys(problems).length) return;
    await store.saveBusiness({ ...business, ...form, name: form.name.trim(), email: form.email.trim() });
    setEditing(null);
    dialog.toast(editing === 'contact' ? 'Business email saved' : 'Business profile saved. Existing invoices and bills are unchanged.', 'success');
  };

  return (
    <>
      <Modal visible={shown} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay, opacity: slide }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close menu" />
        </Animated.View>
        <Animated.View
          accessibilityViewIsModal
          style={[styles.panel, { width: panelWidth, backgroundColor: colors.background, borderColor: colors.border, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12, transform: [{ translateX: slide.interpolate({ inputRange: [0, 1], outputRange: [-panelWidth, 0] }) }] }]}
        >
          <View style={styles.head}>
            <View style={[styles.avatar, { backgroundColor: colors.primary }]}><TextBlock size={17} weight="bold" color={colors.primaryForeground}>{initials || 'U'}</TextBlock></View>
            <View style={{ flex: 1, gap: 2 }}>
              <TextBlock size={15} weight="bold" numberOfLines={2}>{business?.name || 'Your business'}</TextBlock>
              <TextBlock size={12} color={colors.mutedForeground} numberOfLines={1}>{auth.user?.email ?? 'Preview · not signed in'}</TextBlock>
            </View>
            <IconButton icon="x" accessibilityLabel="Close menu" onPress={onClose} />
          </View>

          <ScrollView contentContainerStyle={{ gap: 14, paddingBottom: 12 }} showsVerticalScrollIndicator={false}>
            <Section title="Business profile" action="Edit" onAction={() => edit('profile')}>
              <ListRow icon="briefcase" title={business?.name || 'Not set'} detail={[business?.address, business?.state, business?.pincode].filter(Boolean).join(', ') || 'Add your address'} onPress={() => edit('profile')} testID="menu-profile" />
              <Divider inset={64} />
              <ListRow icon="shield" title="GSTIN" detail={business?.gstin || 'Not added'} />
              <Divider inset={64} />
              <ListRow icon="at-sign" title="Business email" detail={business?.email || 'Not added · tap to add'} onPress={() => edit('contact')} testID="menu-business-contact" />
            </Section>

            <Section title="Contact details">
              <ListRow
                icon="message-circle"
                title="Chat with support"
                detail={supportUnread ? `${supportUnread} new repl${supportUnread === 1 ? 'y' : 'ies'} from our team` : 'Instant answers · our team replies within 24 hours'}
                onPress={() => { onClose(); setTimeout(() => router.push('/support'), 200); }}
                right={supportUnread ? <View style={[styles.badge, { backgroundColor: colors.destructive }]}><TextBlock size={11} weight="bold" color={colors.destructiveForeground}>{String(supportUnread)}</TextBlock></View> : undefined}
                testID="menu-support-chat"
              />
              <Divider inset={64} />
              <ListRow
                icon="mail"
                title="Email us"
                detail={SUPPORT_EMAIL}
                onPress={() => void Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('E-Way Easy support')}`).catch(() => dialog.toast('No email app found on this phone', 'danger'))}
                testID="menu-support-email"
              />
            </Section>

            <Section title="Preferences">
              <View style={{ padding: 14, gap: 10 }}>
                <TextBlock size={13} weight="semibold">Appearance</TextBlock>
                <Segmented<ThemePreference> options={[{ label: 'System', value: 'system' }, { label: 'Light', value: 'light' }, { label: 'Dark', value: 'dark' }]} value={theme} onChange={(value) => void setThemePreference(value)} />
                <Divider />
                <View style={styles.row}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <TextBlock size={14} weight="semibold">Cloud sync</TextBlock>
                    <TextBlock size={12} color={colors.mutedForeground}>{store.syncState === 'syncing' ? 'Syncing now…' : store.online === false ? 'Offline — saved on this phone' : store.lastSyncAt ? `Last synced ${relativeTime(store.lastSyncAt)}` : 'Not synced yet'}</TextBlock>
                  </View>
                  <Button title="Sync" size="sm" variant="outline" icon="refresh-cw" onPress={() => void store.syncNow().then(() => dialog.toast('Sync complete', 'success'))} loading={store.syncState === 'syncing'} />
                </View>
                <Divider />
                <View style={styles.row}>
                  <TextBlock size={14} weight="semibold" style={{ flex: 1 }}>Language & currency</TextBlock>
                  <TextBlock size={13} color={colors.mutedForeground}>English · ₹ INR</TextBlock>
                </View>
              </View>
            </Section>
            <TextBlock size={11} color={colors.mutedForeground} style={{ textAlign: 'center' }}>E-Way Easy · Version {Constants.expoConfig?.version ?? '1.0.0'}</TextBlock>
          </ScrollView>
        </Animated.View>
      </Modal>

      <Sheet
        visible={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'contact' ? 'Business email' : 'Business profile'}
        subtitle={editing === 'contact' ? 'Printed on new invoices.' : 'Changes apply to new invoices only.'}
        footer={<Button title="Save" onPress={() => void save()} testID="menu-save" />}
      >
        {form ? (
          <View style={{ paddingHorizontal: 18, gap: 12 }}>
            {editing === 'contact' ? (
              <>
                <Field label="Email" value={form.email} onChangeText={(email) => setForm({ ...form, email })} keyboardType="email-address" autoCapitalize="none" placeholder="name@business.com" error={errors.email} />
              </>
            ) : (
              <>
                <Field label="Legal business name" required value={form.name} onChangeText={(value) => setForm({ ...form, name: value })} error={errors.name} autoCapitalize="words" />
                <Field label="Address" value={form.address} onChangeText={(value) => setForm({ ...form, address: value })} multiline />
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1.3 }}><SelectField label="State" value={form.state} placeholder="Choose" options={stateOptions} onSelect={(value) => setForm({ ...form, state: value })} /></View>
                  <View style={{ flex: 1 }}><Field label="PIN code" value={form.pincode ?? ''} onChangeText={(value) => setForm({ ...form, pincode: value.replace(/\D/g, '').slice(0, 6) })} keyboardType="number-pad" error={errors.pincode} /></View>
                </View>
              </>
            )}
          </View>
        ) : null}
      </Sheet>
    </>
  );
}

function Section({ title, action, onAction, children }: { title: string; action?: string; onAction?: () => void; children: React.ReactNode }) {
  const colors = useColors();
  return (
    <View style={{ gap: 6 }}>
      <View style={styles.sectionHead}>
        <TextBlock size={12} weight="bold" color={colors.mutedForeground} style={{ flex: 1, letterSpacing: 0.6 }}>{title.toUpperCase()}</TextBlock>
        {action ? <Pressable onPress={onAction} hitSlop={8} accessibilityRole="button" accessibilityLabel={`${action} ${title}`}><TextBlock size={13} weight="semibold" color={colors.primary}>{action}</TextBlock></Pressable> : null}
      </View>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius + 2 }]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRightWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, gap: 14, borderTopRightRadius: 20, borderBottomRightRadius: 20 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 46, height: 46, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  sectionHead: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4 },
  card: { borderWidth: 1, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  badge: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
});

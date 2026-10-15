import React, { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card, Notice, ScreenHeader, Segmented, TextBlock } from '@/components/AppUI';
import { useDialog } from '@/components/Dialog';
import { SignaturePad, type Strokes } from '@/components/SignaturePad';
import { SignatureView } from '@/components/SignatureView';
import { useColors } from '@/hooks/useColors';
import { MAX_SIGNATURE_BYTES, type Signature } from '@/lib/domain';
import { useAppStore } from '@/state/app-store';

/**
 * The authorised signatory's signature: added once (drawn or uploaded) and printed
 * on every invoice. Saved with the business profile, so it syncs to every device.
 */
export default function SignatureScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const store = useAppStore();
  const dialog = useDialog();
  const saved = store.business?.signature;
  const [mode, setMode] = useState<'draw' | 'upload'>('draw');
  const [strokes, setStrokes] = useState<Strokes>({ paths: [], width: 0, height: 200 });
  const [image, setImage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (signature: Signature | undefined) => {
    if (!store.business) return;
    setBusy(true);
    try {
      await store.saveBusiness({ ...store.business, signature });
      dialog.toast(signature ? 'Signature saved. It prints on every invoice.' : 'Signature removed', 'success');
      if (signature && router.canGoBack()) router.back();
    } finally {
      setBusy(false);
    }
  };

  const pickImage = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: ['image/png', 'image/jpeg'], copyToCacheDirectory: true, multiple: false });
    const asset = result.canceled ? null : result.assets[0];
    if (!asset) return;
    if ((asset.size ?? 0) > MAX_SIGNATURE_BYTES) return dialog.toast('Choose a smaller image (under 250 KB). A cropped photo of the signature works best.', 'danger');
    const mime = asset.mimeType ?? (asset.name.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg');
    const base64 = asset.file ? await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(asset.file!);
    }) : await new File(asset.uri).base64();
    setImage(`data:${mime};base64,${base64}`);
  };

  const remove = async () => {
    const ok = await dialog.confirm({ title: 'Remove signature?', message: 'Invoices will print without a signature until you add one again.', confirmLabel: 'Remove', tone: 'danger', icon: 'trash-2' });
    if (ok) await save(undefined);
  };

  const now = () => new Date().toISOString();
  const ready = mode === 'draw' ? strokes.paths.length > 0 : Boolean(image);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader title="Signature" subtitle="Added once, printed on every invoice" />
      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 30 }]} scrollEnabled={mode !== 'draw' || !strokes.paths.length}>
        {saved ? (
          <Card style={{ gap: 10 }}>
            <TextBlock size={12} weight="semibold" color={colors.mutedForeground}>SAVED SIGNATURE</TextBlock>
            <View style={styles.preview}><SignatureView signature={saved} height={60} /></View>
            <TextBlock size={12} color={colors.mutedForeground}>Printed above "Authorised signatory" on your invoices. Draw or upload a new one below to replace it.</TextBlock>
            <Button title="Remove signature" icon="trash-2" variant="ghost" size="sm" onPress={() => void remove()} />
          </Card>
        ) : (
          <Notice title="Add your signature once" body="It prints on every invoice automatically, so you never sign each invoice by hand." />
        )}

        <Segmented value={mode} onChange={(value) => setMode(value as 'draw' | 'upload')} options={[{ value: 'draw', label: 'Draw' }, { value: 'upload', label: 'Upload image' }]} />

        {mode === 'draw' ? (
          <View style={{ gap: 10 }}>
            <SignaturePad strokes={strokes.paths} onChange={setStrokes} />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Button title="Clear" icon="rotate-ccw" variant="outline" onPress={() => setStrokes({ paths: [], width: 0, height: 200 })} disabled={!strokes.paths.length} style={{ flex: 1 }} />
              <Button title="Save signature" icon="check" onPress={() => void save({ kind: 'drawn', paths: strokes.paths, width: strokes.width || 320, height: strokes.height, updatedAt: now() })} disabled={!ready || busy} loading={busy} style={{ flex: 2 }} testID="signature-save" />
            </View>
          </View>
        ) : (
          <View style={{ gap: 10 }}>
            <Card style={{ gap: 10, alignItems: 'center' }}>
              {image ? <View style={styles.preview}><SignatureView signature={{ kind: 'image', dataUri: image, updatedAt: '' }} height={70} /></View> : <TextBlock size={13} color={colors.mutedForeground}>Sign on white paper, take a photo, crop it to the signature, and upload it (PNG or JPG, under 250 KB).</TextBlock>}
              <Button title={image ? 'Choose another image' : 'Choose image'} icon="image" variant="outline" onPress={() => void pickImage()} />
            </Card>
            <Button title="Save signature" icon="check" onPress={() => image && void save({ kind: 'image', dataUri: image, updatedAt: now() })} disabled={!ready || busy} loading={busy} />
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 14, maxWidth: 720, width: '100%', alignSelf: 'center' },
  preview: { backgroundColor: '#ffffff', borderRadius: 12, padding: 10, alignItems: 'center', alignSelf: 'stretch' },
});

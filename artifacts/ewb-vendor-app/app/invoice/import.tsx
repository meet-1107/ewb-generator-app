import React, { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { Button, Card, Heading, Notice, Page, TextBlock } from '@/components/AppUI';
import { useAppStore } from '@/state/app-store';
import { newInvoice } from '@/lib/domain';

export default function PdfImportScreen() {
  const colors = useColors();
  const { business, saveInvoice } = useAppStore();
  const [file, setFile] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [busy, setBusy] = useState(false);

  const choosePdf = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (!result.canceled) setFile(result.assets[0] ?? null);
    } catch {
      Alert.alert('Could not open documents', 'Try again or start a manual invoice.');
    }
  };

  const startManualDraft = async () => {
    const invoice = {
      ...newInvoice('classic'),
      sellerName: business?.name ?? '',
      sellerGstin: business?.gstin ?? '',
      sellerAddress: business?.address ?? '',
      sellerState: business?.state ?? '',
      sourceFileName: file?.name,
    };
    setBusy(true);
    try {
      await saveInvoice(invoice);
      router.replace(`/invoice/${invoice.id}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page contentStyle={styles.page}>
      <Heading eyebrow="Start from a document" title="Import an invoice PDF" subtitle="Choose a PDF and review the details manually. Extracted values are never treated as verified." />
      <Notice title="Parser and secure upload are not connected" body="This build will not upload or send your PDF to a third party. It can save a local draft linked to the filename, then you can enter and review every value." tone="warning" />
      <Card>
        <TextBlock size={14} weight="semibold">Your document stays on this device</TextBlock>
        <TextBlock size={12} color={colors.mutedForeground} style={{ lineHeight: 19 }}>Supported file: PDF. The original file is not uploaded or retained by this app build. A provider and retention policy must be approved before extraction is enabled.</TextBlock>
        {file ? (
          <View style={[styles.file, { borderColor: colors.border, backgroundColor: colors.background }]}>
            <View style={[styles.fileIcon, { backgroundColor: colors.accent }]}><Feather name="file-text" size={18} color={colors.primary} /></View>
            <View style={{ flex: 1, gap: 3 }}><TextBlock size={13} weight="semibold" numberOfLines={1}>{file.name}</TextBlock><TextBlock size={11} color={colors.mutedForeground}>{typeof file.size === 'number' ? `${(file.size / 1024).toFixed(0)} KB` : 'PDF selected'} · review needed</TextBlock></View>
            <Pressable accessibilityRole="button" accessibilityLabel="Remove PDF" onPress={() => setFile(null)} hitSlop={8}><Feather name="x" size={18} color={colors.mutedForeground} /></Pressable>
          </View>
        ) : (
          <Pressable onPress={choosePdf} style={[styles.picker, { borderColor: colors.border, backgroundColor: colors.background }]} accessibilityRole="button" testID="choose-pdf">
            <View style={[styles.uploadIcon, { backgroundColor: colors.accent }]}><Feather name="upload-cloud" size={20} color={colors.primary} /></View>
            <TextBlock size={14} weight="semibold">Choose a PDF</TextBlock>
            <TextBlock size={11} color={colors.mutedForeground}>Browse your files</TextBlock>
          </Pressable>
        )}
        {file ? <Button title="Replace PDF" icon="refresh-cw" secondary onPress={choosePdf} /> : null}
      </Card>
      <View style={{ gap: 10 }}>
        <Button title={file ? 'Create review draft' : 'Continue with manual invoice'} icon="arrow-right" onPress={startManualDraft} loading={busy} />
        <Button title="Back to invoices" secondary onPress={() => router.back()} />
      </View>
      <TextBlock size={11} color={colors.mutedForeground} style={{ textAlign: 'center', lineHeight: 17 }}>No parser status or extracted values will be shown until an approved processing service is configured.</TextBlock>
    </Page>
  );
}

const styles = StyleSheet.create({
  page: { gap: 19 },
  file: { borderWidth: 1, borderRadius: 15, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 11 },
  fileIcon: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  picker: { minHeight: 146, borderWidth: 1, borderStyle: 'dashed', borderRadius: 17, alignItems: 'center', justifyContent: 'center', gap: 6 },
  uploadIcon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginBottom: 3 },
});

import React, { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { Button, Card, ConfidenceTag, KeyValue, Notice, ProgressSteps, ScreenHeader, TextBlock } from '@/components/AppUI';
import { useDialog } from '@/components/Dialog';
import { useAppStore } from '@/state/app-store';
import { api, ApiError, type ExtractedInvoice } from '@/lib/api';
import { draftForBusiness, expectedSupplyType, formatDate, formatInr, invoiceTotals, newLine, UNITS, type Confidence, type Invoice } from '@/lib/domain';

const MAX_BYTES = 8 * 1024 * 1024;
type Stage = 'choose' | 'reading' | 'extracting' | 'review' | 'failed';

async function toBase64(asset: DocumentPicker.DocumentPickerAsset) {
  if (Platform.OS === 'web') {
    const blob = asset.file ?? (await (await fetch(asset.uri)).blob());
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    return btoa(binary);
  }
  return new File(asset.uri).base64();
}

const LABELS: [keyof ExtractedInvoice, string][] = [
  ['invoiceNumber', 'Invoice number'], ['invoiceDate', 'Invoice date'],
  ['sellerName', 'Seller'], ['sellerGstin', 'Seller GSTIN'], ['sellerState', 'Seller state'], ['sellerPincode', 'Seller PIN'],
  ['buyerName', 'Buyer'], ['buyerGstin', 'Buyer GSTIN'], ['buyerState', 'Buyer state'], ['buyerPincode', 'Buyer PIN'],
  ['vehicleNumber', 'Vehicle'], ['transporterName', 'Transporter'], ['transporterId', 'Transporter ID'], ['taxablePaise', 'Taxable value'], ['totalPaise', 'Invoice total'],
];

export default function PdfImportScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const dialog = useDialog();
  const store = useAppStore();
  const [file, setFile] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [stage, setStage] = useState<Stage>('choose');
  const [fields, setFields] = useState<ExtractedInvoice | null>(null);
  const [failure, setFailure] = useState('');
  const [retention, setRetention] = useState('');

  const choosePdf = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true, multiple: false });
      if (result.canceled || !result.assets[0]) return;
      const asset = result.assets[0];
      if (asset.size && asset.size > MAX_BYTES) {
        await dialog.alert({ title: 'File is too large', message: 'Choose a PDF under 8 MB.', tone: 'warning' });
        return;
      }
      setFile(asset);
      setStage('choose');
      setFields(null);
      setFailure('');
    } catch {
      dialog.toast('Could not open your files', 'danger');
    }
  };

  const extract = async () => {
    if (!file) return;
    setFailure('');
    try {
      setStage('reading');
      const base64 = await toBase64(file);
      setStage('extracting');
      const result = await api.parsePdf(file.name, base64);
      setFields(result.fields);
      setRetention(result.retention);
      setStage('review');
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : 'Could not read this file on your device.');
      setStage('failed');
    }
  };

  const createDraft = async (manual = false) => {
    if (!store.business) return;
    const base = draftForBusiness(store.business, store.activeGstin, store.invoices, undefined, store.ewbs);
    const confidence: Record<string, Confidence> = {};
    const original: Record<string, string> = {};
    const invoice: Invoice = { ...base, sourceFileName: file?.name };
    if (fields && !manual) {
      const take = <K extends keyof Invoice>(key: K, candidate: { value: string; confidence: Confidence } | undefined) => {
        if (!candidate?.value) return;
        (invoice[key] as unknown) = candidate.value;
        confidence[key] = candidate.confidence;
        original[key] = candidate.value;
      };
      take('invoiceNumber', fields.invoiceNumber);
      take('invoiceDate', fields.invoiceDate);
      // The seller on a sales invoice is you: keep the profile unless the PDF names one of your registrations.
      const ownGstin = store.business.gstRegistrations?.some((item) => item.gstin === fields.sellerGstin?.value);
      if (fields.sellerGstin && ownGstin) take('sellerGstin', fields.sellerGstin);
      take('buyerName', fields.buyerName);
      take('buyerGstin', fields.buyerGstin);
      take('buyerState', fields.buyerState);
      take('buyerPincode', fields.buyerPincode);
      take('vehicleNumber', fields.vehicleNumber);
      take('transporterName', fields.transporterName);
      take('transporterId', fields.transporterId);
      // No ID on the PDF: a transporter saved earlier brings its ID along.
      const knownTransporter = store.transporters.find((item) => item.name.trim().toLowerCase() === invoice.transporterName.trim().toLowerCase());
      if (!fields.transporterId && fields.transporterName && knownTransporter?.transporterId) invoice.transporterId = knownTransporter.transporterId;
      if (fields.buyerState) invoice.placeOfSupply = fields.buyerState.value;
      invoice.supplyType = expectedSupplyType(invoice) ?? invoice.supplyType;
      if (fields.lines.length) {
        invoice.lines = fields.lines.map((line) => ({
          ...newLine(),
          description: line.description,
          hsn: line.hsn,
          quantity: line.quantity,
          ...(line.unit && UNITS.includes(line.unit) ? { unit: line.unit } : {}),
          ...(line.unitPricePaise ? { unitPricePaise: line.unitPricePaise } : {}),
          taxablePaise: line.taxablePaise,
          taxRate: line.taxRate,
        }));
        confidence.lines = 'low';
      }
      invoice.extraction = { parserVersion: 'heuristic-1', fields: confidence, original, confirmed: false };
    }
    await store.saveInvoice(invoice);
    router.replace(`/invoice/${invoice.id}`);
  };

  const found = fields ? LABELS.filter(([key]) => fields[key] && typeof fields[key] === 'object' && 'value' in (fields[key] as object)) : [];
  const ownGstinMismatch = fields?.sellerGstin && !store.business?.gstRegistrations?.some((item) => item.gstin === fields.sellerGstin?.value);
  const busy = stage === 'reading' || stage === 'extracting';
  const lineTotal = fields?.lines.length ? invoiceTotals({ lines: fields.lines.map((line) => ({ ...newLine(), ...line })), supplyType: 'inter' }).total : 0;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader title="Import invoice PDF" subtitle="Turn a PDF into a draft in seconds" />
      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 30 }]}>
        <ProgressSteps steps={['Choose', 'Read', 'Review']} current={stage === 'review' ? 2 : busy ? 1 : 0} />
        <Card>
          <View style={styles.info}>
            <Feather name="shield" size={16} color={colors.primary} />
            <TextBlock size={12} color={colors.mutedForeground} style={{ flex: 1, lineHeight: 18 }}>PDF up to 8 MB with selectable text. It is read in memory on our server and is not stored. Every value is a suggestion you review.</TextBlock>
          </View>
          {file ? (
            <View style={[styles.file, { borderColor: colors.border, backgroundColor: colors.background }]}>
              <View style={[styles.fileIcon, { backgroundColor: colors.dangerBackground }]}><TextBlock size={10} weight="bold" color={colors.dangerForeground}>PDF</TextBlock></View>
              <View style={{ flex: 1, gap: 3 }}>
                <TextBlock size={14} weight="semibold" numberOfLines={1}>{file.name}</TextBlock>
                <TextBlock size={12} color={colors.mutedForeground}>{typeof file.size === 'number' ? `${Math.max(1, Math.round(file.size / 1024))} KB` : 'PDF'} · {stage === 'review' ? 'Read' : stage === 'failed' ? 'Could not read' : 'Ready'}</TextBlock>
              </View>
              {!busy ? <Pressable onPress={() => { setFile(null); setStage('choose'); setFields(null); }} hitSlop={10} accessibilityRole="button" accessibilityLabel="Remove PDF"><Feather name="x" size={19} color={colors.mutedForeground} /></Pressable> : null}
            </View>
          ) : (
            <Pressable onPress={() => void choosePdf()} style={({ pressed }) => [styles.picker, { borderColor: colors.input, backgroundColor: pressed ? colors.muted : colors.background }]} accessibilityRole="button" testID="choose-pdf">
              <View style={[styles.uploadIcon, { backgroundColor: colors.accent }]}><Feather name="upload-cloud" size={22} color={colors.primary} /></View>
              <TextBlock size={15} weight="semibold">Choose a PDF</TextBlock>
              <TextBlock size={12} color={colors.mutedForeground}>From Files, Downloads, Drive or email</TextBlock>
            </Pressable>
          )}
          {busy ? (
            <View style={styles.progressRow}><ActivityIndicator color={colors.primary} /><TextBlock size={13} color={colors.mutedForeground}>{stage === 'reading' ? 'Preparing file…' : 'Reading invoice details…'}</TextBlock></View>
          ) : file && stage !== 'review' ? (
            <View style={{ gap: 9 }}>
              <Button title="Read this PDF" icon="zap" onPress={() => void extract()} testID="extract-pdf" />
              <Button title="Choose a different PDF" variant="ghost" size="sm" onPress={() => void choosePdf()} />
            </View>
          ) : null}
        </Card>

        {stage === 'failed' ? (
          <Notice tone="warning" title="We couldn't read this PDF" body={`${failure} You can still create the invoice by typing the details.`} action="Enter details manually" onAction={() => void createDraft(true)} />
        ) : null}

        {stage === 'review' && fields ? (
          <>
            <Card>
              <View style={styles.reviewHead}>
                <TextBlock size={16} weight="semibold" style={{ flex: 1 }}>Found {found.length} field{found.length === 1 ? '' : 's'}{fields.lines.length ? ` and ${fields.lines.length} item${fields.lines.length === 1 ? '' : 's'}` : ''}</TextBlock>
                <TextBlock size={11} color={colors.mutedForeground}>{fields.pageCount} page{fields.pageCount === 1 ? '' : 's'}</TextBlock>
              </View>
              {found.map(([key, label]) => {
                const candidate = fields[key] as { value: string | number; confidence: Confidence };
                const value = key === 'totalPaise' || key === 'taxablePaise' ? formatInr(Number(candidate.value)) : key === 'invoiceDate' ? formatDate(String(candidate.value)) : String(candidate.value);
                return (
                  <View key={key} style={styles.foundRow}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <TextBlock size={11} color={colors.mutedForeground}>{label}</TextBlock>
                      <TextBlock size={14} weight="medium" selectable>{value}</TextBlock>
                    </View>
                    <ConfidenceTag level={candidate.confidence} />
                  </View>
                );
              })}
              {fields.lines.length ? <KeyValue label="Items total (estimated)" value={formatInr(lineTotal)} /> : null}
              {!found.length && !fields.lines.length ? <TextBlock size={13} color={colors.mutedForeground}>No invoice fields were recognised. The layout may be unusual — continue and type the details.</TextBlock> : null}
            </Card>
            {ownGstinMismatch ? <Notice tone="warning" title="Seller GSTIN differs from your profile" body={`The PDF shows ${fields.sellerGstin?.value}. Your draft keeps your registered GSTIN ${store.activeGstin} — sales invoices must be issued by you.`} /> : null}
            <Notice tone="info" title="Nothing is final yet" body="The next screen opens the draft with these values tagged. Check every field, then continue to e-way bill review." />
            <Button title="Add to invoice" icon="arrow-right" onPress={() => void createDraft()} testID="import-continue" />
            <Button title="Ignore and type manually" variant="ghost" onPress={() => void createDraft(true)} />
            {retention ? <TextBlock size={11} color={colors.mutedForeground} style={{ textAlign: 'center' }}>{retention}</TextBlock> : null}
          </>
        ) : null}

        {stage === 'choose' && !file ? <Button title="Skip — create invoice manually" variant="ghost" onPress={() => router.replace('/invoice/new')} /> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 14, maxWidth: 720, width: '100%', alignSelf: 'center' },
  info: { flexDirection: 'row', gap: 9, alignItems: 'flex-start' },
  file: { borderWidth: 1, borderRadius: 15, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 11 },
  fileIcon: { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  picker: { minHeight: 160, borderWidth: 1.5, borderStyle: 'dashed', borderRadius: 18, alignItems: 'center', justifyContent: 'center', gap: 6 },
  uploadIcon: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  reviewHead: { flexDirection: 'row', alignItems: 'center' },
  foundRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 42 },
});

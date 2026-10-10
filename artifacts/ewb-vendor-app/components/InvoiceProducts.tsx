import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Button, Card, Checkbox, Field, MoneyField, Notice, Segmented, SelectField, SelectSheet, Sheet, TextBlock } from '@/components/AppUI';
import { useColors } from '@/hooks/useColors';
import { formatInr, GST_RATES, lineTax, lineTaxable, uid, UNITS, type InvoiceLine, type Product } from '@/lib/domain';

/** Lines with nothing in them (the blank line a new invoice starts with). */
const isBlank = (line: InvoiceLine) => !line.description.trim() && !line.taxablePaise;

type Draft = {
  lineId?: string;
  /** Name, HSN, unit and GST rate are editable (new product, or editing a line). */
  details: boolean;
  saveToList: boolean;
  description: string;
  hsn: string;
  unit: string;
  taxRate: number;
  quantity: string;
  ratePaise: number;
  discountMode: 'amount' | 'percent';
  discountPaise: number;
  discountPercent: string;
  /** A line read from a PDF without a rate keeps its taxable value until the rate is changed. */
  keepTaxable?: number;
};

function amounts(draft: Draft) {
  const gross = Math.round((Number(draft.quantity) || 0) * draft.ratePaise);
  const discount = draft.discountMode === 'percent' ? Math.round((gross * (Number(draft.discountPercent) || 0)) / 100) : draft.discountPaise;
  const taxable = draft.keepTaxable ?? lineTaxable(draft.quantity, draft.ratePaise, discount);
  return { gross, discount: draft.keepTaxable === undefined ? Math.min(discount, gross) : 0, taxable, tax: Math.round((taxable * draft.taxRate) / 100) };
}

/**
 * The invoice's products: pick one from the saved product list (HSN, unit,
 * rate and GST come with it), then confirm quantity, rate and discount. Each
 * product added becomes a line; tap a line to change it.
 */
export function InvoiceProducts({ lines, products, error, lineError, onChange, onSaveProduct }: {
  lines: InvoiceLine[];
  products: Product[];
  error?: string;
  lineError: (lineId: string) => string | undefined;
  onChange: (lines: InvoiceLine[]) => void;
  onSaveProduct: (product: Omit<Product, 'id' | 'updatedAt'>) => void;
}) {
  const colors = useColors();
  const [picking, setPicking] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const filled = lines.filter((line) => !isBlank(line));

  const open = (next: Draft) => {
    setErrors({});
    // Let the product list close before the next sheet opens.
    setTimeout(() => setDraft(next), 250);
  };

  const fromProduct = (product: Product) => open({
    details: false, saveToList: false, description: product.name, hsn: product.hsn, unit: product.unit, taxRate: product.taxRate,
    quantity: '1', ratePaise: product.unitPricePaise, discountMode: 'amount', discountPaise: 0, discountPercent: '',
  });
  const newProduct = () => open({
    details: true, saveToList: true, description: '', hsn: '', unit: 'Nos', taxRate: 18,
    quantity: '1', ratePaise: 0, discountMode: 'amount', discountPaise: 0, discountPercent: '',
  });
  const editLine = (line: InvoiceLine) => {
    setErrors({});
    setDraft({
      lineId: line.id, details: true, saveToList: false, description: line.description, hsn: line.hsn, unit: line.unit, taxRate: line.taxRate,
      quantity: line.quantity, ratePaise: line.unitPricePaise ?? 0, discountMode: 'amount', discountPaise: line.discountPaise ?? 0, discountPercent: '',
      keepTaxable: line.unitPricePaise ? undefined : line.taxablePaise,
    });
  };

  const save = () => {
    if (!draft) return;
    const next: Record<string, string> = {};
    if (!draft.description.trim()) next.description = 'Product name is required.';
    if (!/^\d{4}(\d{2})?(\d{2})?$/.test(draft.hsn.trim())) next.hsn = 'HSN/SAC must be 4, 6 or 8 digits.';
    if (!(Number(draft.quantity) > 0)) next.quantity = 'Enter the quantity.';
    if (draft.keepTaxable === undefined && !(draft.ratePaise > 0)) next.rate = 'Enter the rate.';
    const { gross, discount, taxable } = amounts(draft);
    if (draft.keepTaxable === undefined && discount >= gross && gross > 0) next.discount = 'Discount must be less than the amount.';
    setErrors(next);
    if (Object.keys(next).length) return;
    const line: InvoiceLine = {
      id: draft.lineId ?? uid('l'),
      description: draft.description.trim(),
      hsn: draft.hsn.trim(),
      quantity: draft.quantity,
      unit: draft.unit,
      unitPricePaise: draft.ratePaise || undefined,
      discountPaise: discount || undefined,
      taxablePaise: taxable,
      taxRate: draft.taxRate,
    };
    onChange(draft.lineId ? lines.map((item) => (item.id === draft.lineId ? line : item)) : [...lines.filter((item) => !isBlank(item)), line]);
    if (draft.saveToList) onSaveProduct({ name: line.description, hsn: line.hsn, unit: line.unit, taxRate: line.taxRate, unitPricePaise: draft.ratePaise });
    setDraft(null);
  };

  const remove = () => {
    if (!draft?.lineId) return;
    onChange(lines.filter((item) => item.id !== draft.lineId));
    setDraft(null);
  };

  const preview = draft ? amounts(draft) : null;

  return (
    <View style={{ gap: 10 }}>
      {error ? <Notice tone="danger" title={error} /> : null}
      {filled.map((line, index) => {
        const problem = lineError(line.id);
        return (
          <Pressable key={line.id} onPress={() => editLine(line)} accessibilityRole="button" accessibilityLabel={`${line.description}, ${line.quantity} ${line.unit}, ${formatInr(line.taxablePaise + lineTax(line))}. Tap to change`} testID={`line-${index}`}>
            {({ pressed }) => (
              <View style={[styles.line, { borderColor: problem ? colors.destructive : colors.border, backgroundColor: colors.card, opacity: pressed ? 0.85 : 1 }]}>
                <View style={[styles.lineNo, { backgroundColor: colors.accent }]}><TextBlock size={12} weight="bold" color={colors.primary}>{index + 1}</TextBlock></View>
                <View style={{ flex: 1, gap: 2 }}>
                  <TextBlock size={14} weight="semibold" numberOfLines={1}>{line.description}</TextBlock>
                  <TextBlock size={12} color={colors.mutedForeground}>
                    {line.quantity} {line.unit}{line.unitPricePaise ? ` × ${formatInr(line.unitPricePaise)}` : ''}{line.discountPaise ? ` − ${formatInr(line.discountPaise)} disc.` : ''}
                  </TextBlock>
                  <TextBlock size={11} color={problem ? colors.destructive : colors.mutedForeground}>{problem ?? `HSN ${line.hsn || '—'} · GST ${line.taxRate}%`}</TextBlock>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 2 }}>
                  <TextBlock size={14} weight="bold">{formatInr(line.taxablePaise + lineTax(line))}</TextBlock>
                  <Feather name="edit-2" size={13} color={colors.mutedForeground} />
                </View>
              </View>
            )}
          </Pressable>
        );
      })}
      {!filled.length ? (
        <Card style={styles.empty}>
          <TextBlock size={13} color={colors.mutedForeground}>No products yet. Add them from your product list.</TextBlock>
        </Card>
      ) : null}
      <Button title={filled.length ? 'Add another product' : 'Add product'} icon="plus" variant={filled.length ? 'outline' : 'primary'} onPress={() => (products.length ? setPicking(true) : newProduct())} testID="add-product" />

      <SelectSheet
        visible={picking}
        onClose={() => setPicking(false)}
        title="Choose a product"
        emptyText="No products saved yet."
        options={products.map((product) => ({ value: product.id, label: product.name, detail: `HSN ${product.hsn} · ${product.unit} · ${product.taxRate}%${product.unitPricePaise ? ` · ${formatInr(product.unitPricePaise)}` : ''}` }))}
        onSelect={(id) => {
          const product = products.find((item) => item.id === id);
          setPicking(false);
          if (product) fromProduct(product);
        }}
        footer={<Button title="New product" icon="plus" variant="outline" onPress={() => { setPicking(false); newProduct(); }} testID="new-product" />}
      />

      <Sheet
        visible={Boolean(draft)}
        onClose={() => setDraft(null)}
        title={draft?.lineId ? 'Change product' : draft?.details ? 'New product' : draft?.description ?? 'Product'}
        subtitle={draft && !draft.details ? `HSN ${draft.hsn} · ${draft.unit} · GST ${draft.taxRate}%` : undefined}
        footer={(
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {draft?.lineId ? <Button title="Remove" variant="danger" onPress={remove} style={{ flex: 1 }} /> : null}
            <Button title={draft?.lineId ? 'Update' : 'Add to invoice'} icon="check" onPress={save} style={{ flex: 2 }} testID="line-save" />
          </View>
        )}
      >
        {draft && preview ? (
          <View style={{ paddingHorizontal: 18, gap: 12 }}>
            {draft.details ? (
              <>
                <Field label="Product name" required value={draft.description} onChangeText={(description) => setDraft({ ...draft, description })} error={errors.description} autoCapitalize="words" testID="line-name" />
                <View style={styles.row}>
                  <View style={{ flex: 1 }}><Field label="HSN / SAC" required value={draft.hsn} onChangeText={(hsn) => setDraft({ ...draft, hsn: hsn.replace(/\D/g, '').slice(0, 8) })} error={errors.hsn} keyboardType="number-pad" maxLength={8} testID="line-hsn" /></View>
                  <View style={{ flex: 1 }}><SelectField label="Unit" value={draft.unit} placeholder="Nos" options={UNITS.map((unit) => ({ value: unit, label: unit }))} onSelect={(unit) => setDraft({ ...draft, unit })} /></View>
                </View>
                <SelectField label="GST rate" value={String(draft.taxRate)} placeholder="18%" options={GST_RATES.map((rate) => ({ value: String(rate), label: `${rate}%` }))} onSelect={(rate) => setDraft({ ...draft, taxRate: Number(rate) })} />
              </>
            ) : null}
            <View style={styles.row}>
              <View style={{ flex: 1 }}><Field label={`Quantity (${draft.unit})`} required value={draft.quantity} onChangeText={(quantity) => setDraft({ ...draft, quantity: quantity.replace(/[^0-9.]/g, '') })} error={errors.quantity} keyboardType="decimal-pad" testID="line-qty" /></View>
              <View style={{ flex: 1 }}><MoneyField label="Rate per unit" required paise={draft.ratePaise} onChange={(ratePaise) => setDraft({ ...draft, ratePaise, keepTaxable: undefined })} error={errors.rate} hint={draft.keepTaxable !== undefined ? 'Add a rate to recalculate' : undefined} /></View>
            </View>
            <View style={{ gap: 7 }}>
              <TextBlock size={13} weight="semibold">Discount</TextBlock>
              <Segmented options={[{ label: '₹ Amount', value: 'amount' }, { label: '% Percent', value: 'percent' }]} value={draft.discountMode} onChange={(discountMode) => setDraft({ ...draft, discountMode })} />
              {draft.discountMode === 'amount'
                ? <MoneyField label="Discount amount" paise={draft.discountPaise} onChange={(discountPaise) => setDraft({ ...draft, discountPaise })} error={errors.discount} hint="Leave 0 for no discount" />
                : <Field label="Discount %" value={draft.discountPercent} onChangeText={(discountPercent) => setDraft({ ...draft, discountPercent: discountPercent.replace(/[^0-9.]/g, '').slice(0, 5) })} error={errors.discount} keyboardType="decimal-pad" placeholder="0" />}
            </View>
            {draft.details && !draft.lineId ? <Checkbox checked={draft.saveToList} onToggle={() => setDraft({ ...draft, saveToList: !draft.saveToList })} label="Save to my product list" /> : null}
            <View style={[styles.summary, { backgroundColor: colors.muted }]}>
              {draft.keepTaxable === undefined ? <Row label={`${draft.quantity || 0} × ${formatInr(draft.ratePaise)}`} value={formatInr(preview.gross)} /> : null}
              {preview.discount ? <Row label="Discount" value={`− ${formatInr(preview.discount)}`} /> : null}
              <Row label="Taxable value" value={formatInr(preview.taxable)} />
              <Row label={`GST ${draft.taxRate}%`} value={formatInr(preview.tax)} />
              <Row label="Line total" value={formatInr(preview.taxable + preview.tax)} strong />
            </View>
          </View>
        ) : null}
      </Sheet>
    </View>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.summaryRow}>
      <TextBlock size={13} weight={strong ? 'bold' : 'regular'}>{label}</TextBlock>
      <TextBlock size={13} weight={strong ? 'bold' : 'semibold'}>{value}</TextBlock>
    </View>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'center', gap: 11, borderWidth: 1, borderRadius: 14, padding: 12 },
  lineNo: { width: 28, height: 28, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  empty: { alignItems: 'center', paddingVertical: 18 },
  row: { flexDirection: 'row', gap: 10 },
  summary: { borderRadius: 12, padding: 12, gap: 6 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between' },
});

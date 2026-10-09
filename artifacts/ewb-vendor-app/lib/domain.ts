export type InvoiceStatus = 'draft' | 'ready' | 'ewb_generated';
export type SupplyType = 'intra' | 'inter';

export type InvoiceLine = {
  id: string;
  description: string;
  hsn: string;
  quantity: string;
  unit: string;
  taxablePaise: number;
  taxRate: number;
};

export type Invoice = {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  documentType: string;
  sellerName: string;
  sellerGstin: string;
  sellerAddress: string;
  sellerState: string;
  sellerPincode: string;
  dispatchFrom: string;
  buyerName: string;
  buyerGstin: string;
  buyerAddress: string;
  buyerState: string;
  buyerPincode: string;
  shipTo: string;
  placeOfSupply: string;
  supplyType: SupplyType;
  lines: InvoiceLine[];
  transporterName: string;
  transporterId: string;
  vehicleNumber: string;
  transportMode: string;
  distanceKm: string;
  templateId: string;
  templateVersion: number;
  schemaVersion: number;
  createdBy?: string;
  updatedBy?: string;
  sourceFileName?: string;
  status: InvoiceStatus;
  createdAt: string;
  updatedAt: string;
  revisionHistory: InvoiceRevision[];
};

export type InvoiceRevision = Omit<Invoice, 'revisionHistory'>;

export type GstRegistration = {
  gstin: string;
  displayName: string;
  state: string;
  isDefault: boolean;
};

export type Business = {
  name: string;
  gstin: string;
  state: string;
  address: string;
  phone: string;
  email: string;
  timezone: string;
  gstRegistrations?: GstRegistration[];
  defaultGstin?: string;
};

export const templates = [
  { id: 'classic', name: 'Classic', note: 'Balanced, familiar layout' },
  { id: 'compact', name: 'Compact', note: 'More room for line items' },
  { id: 'tax-summary', name: 'Tax summary', note: 'Clear tax breakdown' },
  { id: 'service', name: 'Services', note: 'Service-first arrangement' },
  { id: 'dispatch', name: 'Dispatch', note: 'Transport details up front' },
  { id: 'minimal', name: 'Minimal', note: 'Focused on essentials' },
] as const;

export function newInvoice(templateId = 'classic'): Invoice {
  const now = new Date().toISOString();
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    invoiceNumber: '',
    invoiceDate: new Date().toISOString().slice(0, 10),
    documentType: 'Tax invoice',
    sellerName: '',
    sellerGstin: '',
    sellerAddress: '',
    sellerState: '',
    sellerPincode: '',
    dispatchFrom: '',
    buyerName: '',
    buyerGstin: '',
    buyerAddress: '',
    buyerState: '',
    buyerPincode: '',
    shipTo: '',
    placeOfSupply: '',
    supplyType: 'intra',
    lines: [
      {
        id: `${Date.now()}-line`,
        description: '',
        hsn: '',
        quantity: '1',
        unit: 'Nos',
        taxablePaise: 0,
        taxRate: 18,
      },
    ],
    transporterName: '',
    transporterId: '',
    vehicleNumber: '',
    transportMode: 'Road',
    distanceKm: '',
    templateId,
    templateVersion: 1,
    schemaVersion: 1,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    revisionHistory: [],
  };
}

export function parseRupees(value: string) {
  const number = Number(value.replace(/,/g, '').trim());
  return Number.isFinite(number) && number >= 0
    ? Math.round(number * 100)
    : 0;
}

export function formatInr(paise: number, compact = false) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
    notation: compact ? 'compact' : 'standard',
  }).format(paise / 100);
}

export function invoiceTotals(invoice: Invoice) {
  const taxable = invoice.lines.reduce((sum, line) => sum + line.taxablePaise, 0);
  const tax = invoice.lines.reduce(
    (sum, line) => sum + Math.round((line.taxablePaise * line.taxRate) / 100),
    0,
  );
  const halfTax = invoice.supplyType === 'intra' ? Math.round(tax / 2) : 0;
  return {
    taxable,
    tax,
    cgst: halfTax,
    sgst: tax - halfTax,
    igst: invoice.supplyType === 'inter' ? tax : 0,
    total: taxable + tax,
  };
}

export function invoiceReadiness(invoice: Invoice) {
  const issues: string[] = [];
  if (!invoice.sellerName.trim()) issues.push('Seller business name');
  if (!invoice.sellerState.trim()) issues.push('Seller state');
  if (invoice.sellerPincode.trim() && !/^\d{6}$/.test(invoice.sellerPincode.trim())) issues.push('Seller PIN code format');
  if (!invoice.sellerGstin.trim()) issues.push('Seller GSTIN');
  else if (!/^[0-9A-Z]{15}$/.test(invoice.sellerGstin.trim().toUpperCase())) issues.push('Seller GSTIN format');
  if (invoice.buyerGstin.trim() && !/^[0-9A-Z]{15}$/.test(invoice.buyerGstin.trim().toUpperCase())) issues.push('Buyer GSTIN format');
  if (!invoice.invoiceNumber.trim()) issues.push('Invoice number');
  if (!invoice.invoiceDate) issues.push('Invoice date');
  else {
    const validDate = /^\d{4}-\d{2}-\d{2}$/.test(invoice.invoiceDate) &&
      !Number.isNaN(Date.parse(invoice.invoiceDate)) &&
      new Date(`${invoice.invoiceDate}T00:00:00.000Z`).toISOString().slice(0, 10) === invoice.invoiceDate;
    if (!validDate) issues.push('Invoice date format');
  }
  if (!invoice.buyerName.trim()) issues.push('Buyer name');
  if (invoice.buyerPincode.trim() && !/^\d{6}$/.test(invoice.buyerPincode.trim())) issues.push('Buyer PIN code format');
  if (!invoice.placeOfSupply.trim()) issues.push('Place of supply');
  if (!invoice.lines.some((line) => line.description.trim() && line.taxablePaise > 0)) {
    issues.push('At least one described line item with a value');
  }
  return issues;
}

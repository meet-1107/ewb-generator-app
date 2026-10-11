import qrcode from 'qrcode-generator';
import { hasDispatch, hasShipTo, type EwbRecord, type Invoice } from '@/lib/domain';

/**
 * The e-way bill laid out as the NIC portal prints it (form EWB-01): QR code,
 * the bill header, Part A, Part B, and the bill number as a barcode. The
 * printed PDF and the in-app preview are both drawn from this one model, so
 * they always match.
 */

export type EwbSheet = {
  qrText: string;
  ewbNumber: string;
  header: [string, string][];
  partA: [string, string][];
  partB: { mode: string; vehicle: string; from: string; enteredDate: string; enteredBy: string; cewb: string; multiVehicle: string }[];
  /** "CANCELLED" / "EXPIRED" stamp, or null. */
  stamp: string | null;
};

const IST = 5.5 * 3_600_000;
const pad = (value: number) => String(value).padStart(2, '0');
function ist(iso: string) {
  const date = new Date(Date.parse(iso) + IST);
  return { d: date.getUTCDate(), m: date.getUTCMonth() + 1, y: date.getUTCFullYear(), h: date.getUTCHours(), min: date.getUTCMinutes(), s: date.getUTCSeconds() };
}
/** 11/10/2026 */
export function nicDate(iso: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso.split('-').reverse().join('/');
  if (!iso || Number.isNaN(Date.parse(iso))) return '';
  const t = ist(iso);
  return `${pad(t.d)}/${pad(t.m)}/${t.y}`;
}
/** 11/10/2026 07:39 PM */
export function nicDateTime(iso: string, seconds = false) {
  if (!iso || Number.isNaN(Date.parse(iso))) return '';
  const t = ist(iso);
  const hour = t.h % 12 || 12;
  return `${nicDate(iso)} ${pad(hour)}:${pad(t.min)}${seconds ? `:${pad(t.s)}` : ''} ${t.h < 12 ? 'AM' : 'PM'}`;
}

const TRANSACTION = ['', 'Regular', 'Bill To - Ship To', 'Bill From - Dispatch From', 'Combination of 2 and 3'];
const place = (where: { place: string; state: string; pincode: string } | null, fallbackState: string) =>
  where ? `${where.place},${where.state.toUpperCase()}-${where.pincode}` : fallbackState.toUpperCase();
const lastPart = (address: string, state: string) => address.split(',').pop()?.trim() || state;
const rupees = (paise: number) => String(Math.round(paise) / 100);

export function ewbSheet(ewb: EwbRecord, invoice?: Invoice | null): EwbSheet {
  // Bills from before the server recorded these take them from the invoice.
  const dispatch = ewb.dispatch ?? (invoice ? (hasDispatch(invoice)
    ? { place: lastPart(invoice.dispatchFrom, invoice.dispatchState), state: invoice.dispatchState, pincode: invoice.dispatchPincode }
    : { place: lastPart(invoice.sellerAddress, invoice.sellerState), state: invoice.sellerState, pincode: invoice.sellerPincode }) : null);
  const delivery = ewb.delivery ?? (invoice ? (hasShipTo(invoice)
    ? { place: lastPart(invoice.shipTo, invoice.shipToState), state: invoice.shipToState, pincode: invoice.shipToPincode }
    : { place: lastPart(invoice.buyerAddress, invoice.buyerState), state: invoice.buyerState, pincode: invoice.buyerPincode }) : null);
  const transactionType = ewb.transactionType ?? (invoice ? (hasDispatch(invoice) ? (hasShipTo(invoice) ? 4 : 3) : hasShipTo(invoice) ? 2 : 1) : 1);
  const km = ewb.nicDistanceKm ?? (Number(ewb.transport.distanceKm) || null);
  const main = [...ewb.lines].sort((a, b) => b.taxablePaise - a.taxablePaise)[0];
  const transporter = [ewb.transport.transporterId, ewb.transport.transporterName].filter(Boolean).join(' - ');
  const fromPlace = dispatch?.place ?? ewb.fromState;
  const vehicleOf = (number: string) => (ewb.transport.mode === 'Road' ? number : [ewb.transport.docNumber, ewb.transport.docDate ? nicDate(ewb.transport.docDate) : ''].filter(Boolean).join(' & '));

  // Part B: the first entry at generation, then each vehicle change / consolidation, newest first.
  const partB: EwbSheet['partB'] = [];
  const firstVehicle = ewb.history.find((item) => item.action === 'Vehicle updated')?.detail.split(' → ')[0];
  const initial = firstVehicle && firstVehicle !== 'None' ? firstVehicle : ewb.history.some((item) => item.action === 'Vehicle updated') ? '' : ewb.transport.vehicleNumber;
  if (initial || ewb.transport.mode !== 'Road') {
    partB.push({ mode: ewb.transport.mode, vehicle: vehicleOf(initial ?? ''), from: fromPlace, enteredDate: nicDateTime(ewb.generatedAt), enteredBy: ewb.sellerGstin, cewb: '-', multiVehicle: '-' });
  }
  for (const item of ewb.history) {
    if (item.action === 'Vehicle updated') {
      const next = item.detail.split(' → ')[1]?.split(' · ')[0] ?? '';
      partB.push({ mode: ewb.transport.mode, vehicle: next, from: fromPlace, enteredDate: nicDateTime(item.at), enteredBy: ewb.sellerGstin, cewb: '-', multiVehicle: '-' });
    } else if (item.action === 'Consolidated') {
      const vehicle = /vehicle (\S+)/.exec(item.detail)?.[1] ?? '';
      partB.push({ mode: ewb.transport.mode, vehicle, from: fromPlace, enteredDate: nicDateTime(item.at), enteredBy: ewb.sellerGstin, cewb: ewb.consolidatedInto ?? '-', multiVehicle: '-' });
    }
  }
  partB.reverse();

  return {
    // As on the portal's print: bill number / generating GSTIN / generation time.
    qrText: `${ewb.ewbNumber}/${ewb.sellerGstin}/${nicDateTime(ewb.generatedAt, true)}`,
    ewbNumber: ewb.ewbNumber,
    header: [
      ['E-Way Bill No:', ewb.ewbNumber.replace(/(\d{4})(?=\d)/g, '$1 ')],
      ['E-Way Bill Date:', nicDateTime(ewb.generatedAt)],
      ['Generated By:', `${ewb.sellerGstin} - ${ewb.sellerName}`],
      ['Valid From:', `${nicDateTime(ewb.generatedAt)}${km ? ` [${km}Kms]` : ''}`],
      ['Valid Until:', nicDate(ewb.validUntil)],
    ],
    partA: [
      ['GSTIN of Supplier', `${ewb.sellerGstin},${ewb.sellerName}`],
      ['Place of Dispatch', place(dispatch, ewb.fromState)],
      ['GSTIN of Recipient', `${ewb.buyerGstin || 'URP'},${ewb.buyerName}`],
      ['Place of Delivery', place(delivery, ewb.toState)],
      ['Document No.', ewb.invoiceNumber],
      ['Document Date', nicDate(ewb.invoiceDate)],
      ['Transaction Type:', TRANSACTION[transactionType] ?? 'Regular'],
      ['Value of Goods', rupees(ewb.totals.total)],
      ['HSN Code', main ? `${main.hsn} - ${main.description.toUpperCase()}` : ''],
      ['Reason for Transportation', 'Outward - Supply'],
      ['Transporter', transporter],
    ],
    partB,
    stamp: ewb.status === 'cancelled' ? 'CANCELLED' : ewb.status !== 'part_b_pending' && Date.now() > Date.parse(ewb.validUntil) ? 'EXPIRED' : null,
  };
}

/** The QR code as one SVG path in module units (size × size), for HTML and react-native-svg alike. */
export function qrPath(text: string) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const size = qr.getModuleCount();
  let d = '';
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) if (qr.isDark(row, col)) d += `M${col} ${row}h1v1h-1z`;
  }
  return { size, d };
}

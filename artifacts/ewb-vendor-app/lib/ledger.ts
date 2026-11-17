import { invoiceTotals, isPurchase, today, type BankAccount, type Invoice } from '@/lib/domain';

/**
 * Money entries for the books (Bank entry, Cash entry, Expenses) and the party ledger.
 *
 * One record per movement of money. `account` is 'cash' or a bank account id from the
 * business profile. Balances, the party ledger and what is still due on an invoice are
 * all worked out from these records plus the saved invoices and purchase bills.
 */
export type EntryKind = 'receipt' | 'payment' | 'transfer' | 'expense' | 'opening';

export type Entry = {
  id: string;
  kind: EntryKind;
  /** 'cash' or a bank account id. Empty for a party's opening balance. */
  account: string;
  /** Transfer: the account the money went to. */
  toAccount?: string;
  /** Always positive, except a party's opening balance (negative = you owe them). */
  amountPaise: number;
  /** yyyy-mm-dd */
  date: string;
  partyName?: string;
  partyGstin?: string;
  /** The invoice or purchase bill this payment is against. */
  invoiceId?: string;
  invoiceNumber?: string;
  /** NEFT, RTGS, UPI, Cheque… */
  mode?: string;
  /** UTR / cheque number. */
  reference?: string;
  note?: string;
  /** Expense category. */
  category?: string;
  /** GST included in an expense bill (input GST). */
  gstPaise?: number;
  /** The GST registration that was selected when the entry was made. */
  gstin?: string;
  createdAt: string;
  updatedAt: string;
};

export const CASH = 'cash';

export const BANK_MODES = ['NEFT', 'RTGS', 'IMPS', 'UPI', 'Cheque', 'Other'];

export const EXPENSE_CATEGORIES: { value: string; icon: 'home' | 'user' | 'truck' | 'zap' | 'phone' | 'coffee' | 'tool' | 'more-horizontal' }[] = [
  { value: 'Rent', icon: 'home' },
  { value: 'Salary', icon: 'user' },
  { value: 'Transport', icon: 'truck' },
  { value: 'Electricity', icon: 'zap' },
  { value: 'Phone', icon: 'phone' },
  { value: 'Tea/Food', icon: 'coffee' },
  { value: 'Repair', icon: 'tool' },
  { value: 'Other', icon: 'more-horizontal' },
];

export const categoryIcon = (category?: string) => EXPENSE_CATEGORIES.find((item) => item.value === category)?.icon ?? 'more-horizontal';

/** Entries for the selected GST registration (entries made before a registration was chosen show everywhere). */
export const scopedEntries = (entries: Entry[], gstin: string) => {
  const active = gstin.toUpperCase();
  return entries.filter((entry) => !active || !entry.gstin || entry.gstin.toUpperCase() === active);
};

export function accountLabel(account: string, banks: BankAccount[]) {
  if (account === CASH) return 'Cash';
  const bank = banks.find((item) => item.id === account);
  return bank ? `${bank.bankName} ••${bank.accountNumber.slice(-4)}` : 'Bank';
}

/** How an entry changes `account`'s balance, in paise (+ money in, − money out). */
export function accountEffect(entry: Entry, account: string) {
  if (entry.kind === 'transfer') return (entry.toAccount === account ? entry.amountPaise : 0) - (entry.account === account ? entry.amountPaise : 0);
  if (entry.account !== account) return 0;
  if (entry.kind === 'receipt' || entry.kind === 'opening') return entry.amountPaise;
  return -entry.amountPaise;
}

/** The entries of one account (or several together, e.g. every bank), newest first, each with the balance after it. */
export function accountBook(entries: Entry[], account: string | string[]) {
  const accounts = Array.isArray(account) ? account : [account];
  const mine = entries
    .filter((entry) => accounts.includes(entry.account) || accounts.includes(entry.toAccount ?? ''))
    .filter((entry) => !(entry.kind === 'opening' && !entry.account))
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
  let balance = 0;
  const rows = mine.map((entry) => {
    // A transfer between two of the accounts shown together nets to zero.
    const effect = accounts.reduce((sum, item) => sum + accountEffect(entry, item), 0);
    balance += effect;
    return { entry, effect, balance };
  });
  return { rows: rows.reverse(), balance };
}

export type Period = 'month' | 'last' | 'fy' | 'all';

export const PERIODS: { value: Period; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'month', label: 'This month' },
  { value: 'last', label: 'Last month' },
  { value: 'fy', label: 'This FY' },
];

/** First and last day (yyyy-mm-dd) of a period, in India time. */
export function periodRange(period: Period, now = today()): { from: string; to: string; label: string } {
  const [y, m] = now.split('-').map(Number) as [number, number];
  const pad = (n: number) => String(n).padStart(2, '0');
  const monthName = (year: number, month: number) => new Date(Date.UTC(year, month - 1, 1)).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const lastDay = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (period === 'month') return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${lastDay(y, m)}`, label: monthName(y, m) };
  if (period === 'last') {
    const ly = m === 1 ? y - 1 : y;
    const lm = m === 1 ? 12 : m - 1;
    return { from: `${ly}-${pad(lm)}-01`, to: `${ly}-${pad(lm)}-${lastDay(ly, lm)}`, label: monthName(ly, lm) };
  }
  if (period === 'fy') {
    const start = m >= 4 ? y : y - 1;
    return { from: `${start}-04-01`, to: `${start + 1}-03-31`, label: `FY ${start}-${String(start + 1).slice(2)}` };
  }
  return { from: '0000-01-01', to: '9999-12-31', label: 'All time' };
}

export const inPeriod = (date: string, range: { from: string; to: string }) => date >= range.from && date <= range.to;

/** A party is the same business by GSTIN, else by name. */
export const partyKey = (name?: string, gstin?: string) => (gstin?.trim() ? gstin.trim().toUpperCase() : `name:${(name ?? '').trim().toLowerCase()}`);

/** Credit note: money back to the buyer (sales) or from the seller (purchase); delivery challans are not sales. */
const SIGN: Record<string, number> = { 'credit note': -1, 'debit note': 1, 'delivery challan': 0 };

/**
 * How a document counts in money: +1 (invoice, debit note), -1 (credit note), 0 (delivery
 * challan: only a rough challan, never part of what is owed, paid or sold).
 */
export const ledgerSign = (invoice: Pick<Invoice, 'documentType'>) => SIGN[(invoice.documentType || 'Tax invoice').trim().toLowerCase()] ?? 1;

export type LedgerLine = {
  date: string;
  /** Sort key within a day. */
  at: string;
  title: string;
  detail: string;
  /** Debit (you are to receive more) and credit (to receive less / to pay more), paise. */
  debit: number;
  credit: number;
  invoiceId?: string;
  entryId?: string;
};

export type PartySummary = { key: string; name: string; gstin: string; balance: number; invoices: number; bills: number; lastDate: string };

/** Ledger lines for every party: sales are debits, purchases credits, payments clear them. */
function partyLines(invoices: Invoice[], entries: Entry[]) {
  const map = new Map<string, { name: string; gstin: string; lines: LedgerLine[]; invoices: number; bills: number }>();
  const get = (name: string, gstin: string) => {
    const key = partyKey(name, gstin);
    const found = map.get(key);
    if (found) {
      if (!found.gstin && gstin) found.gstin = gstin;
      return found;
    }
    const created = { name: name.trim(), gstin: gstin.trim().toUpperCase(), lines: [] as LedgerLine[], invoices: 0, bills: 0 };
    map.set(key, created);
    return created;
  };
  for (const invoice of invoices) {
    if (invoice.status === 'draft' || invoice.unsaved) continue;
    const sign = ledgerSign(invoice);
    if (!sign) continue;
    const purchase = isPurchase(invoice);
    const name = purchase ? invoice.sellerName : invoice.buyerName;
    if (!name.trim()) continue;
    const party = get(name, purchase ? invoice.sellerGstin : invoice.buyerGstin);
    const total = invoiceTotals(invoice).total;
    // A sale makes the buyer owe you (debit); a purchase makes you owe the seller (credit).
    const amount = (purchase ? -1 : 1) * sign * total;
    party.lines.push({
      date: invoice.invoiceDate,
      at: invoice.createdAt,
      title: `${purchase ? 'Purchase' : invoice.documentType === 'Tax invoice' ? 'Sale' : invoice.documentType} · ${invoice.invoiceNumber || 'No number'}`,
      detail: purchase ? 'Purchase bill' : invoice.documentType,
      debit: amount > 0 ? amount : 0,
      credit: amount < 0 ? -amount : 0,
      invoiceId: invoice.id,
    });
    if (purchase) party.bills += 1;
    else party.invoices += 1;
  }
  for (const entry of entries) {
    if (!entry.partyName?.trim() || entry.kind === 'transfer' || entry.kind === 'expense') continue;
    if (entry.kind === 'opening' && entry.account) continue;
    const party = get(entry.partyName, entry.partyGstin ?? '');
    // Money received lowers what they owe (credit); money paid lowers what you owe (debit).
    const amount = entry.kind === 'receipt' ? -entry.amountPaise : entry.amountPaise;
    party.lines.push({
      date: entry.date,
      at: entry.createdAt,
      title: entry.kind === 'opening' ? 'Opening balance' : entry.kind === 'receipt' ? 'Payment received' : 'Payment made',
      detail: [entry.kind === 'opening' ? '' : entry.account === CASH ? 'Cash' : entry.mode || 'Bank', entry.invoiceNumber ? `against ${entry.invoiceNumber}` : '', entry.reference].filter(Boolean).join(' · '),
      debit: amount > 0 ? amount : 0,
      credit: amount < 0 ? -amount : 0,
      entryId: entry.id,
    });
  }
  return map;
}

/** Every party with its balance: positive = to receive, negative = to pay. */
export function partySummaries(invoices: Invoice[], entries: Entry[]): PartySummary[] {
  return [...partyLines(invoices, entries).entries()].map(([key, party]) => ({
    key,
    name: party.name,
    gstin: party.gstin,
    balance: party.lines.reduce((sum, line) => sum + line.debit - line.credit, 0),
    invoices: party.invoices,
    bills: party.bills,
    lastDate: party.lines.reduce((latest, line) => (line.date > latest ? line.date : latest), ''),
  })).sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance) || a.name.localeCompare(b.name));
}

/** One party's statement, oldest first, with the running balance after each line. */
export function partyStatement(invoices: Invoice[], entries: Entry[], key: string) {
  const party = partyLines(invoices, entries).get(key);
  if (!party) return null;
  const lines = [...party.lines].sort((a, b) => a.date.localeCompare(b.date) || a.at.localeCompare(b.at));
  let balance = 0;
  const rows = lines.map((line) => {
    balance += line.debit - line.credit;
    return { ...line, balance };
  });
  return { name: party.name, gstin: party.gstin, rows, balance };
}

/** What is still unpaid on an invoice or purchase bill after the payments made against it. */
export function amountDue(invoice: Invoice, entries: Entry[]) {
  const paid = entries.filter((entry) => entry.invoiceId === invoice.id && (entry.kind === 'receipt' || entry.kind === 'payment')).reduce((sum, entry) => sum + entry.amountPaise, 0);
  return Math.max(0, invoiceTotals(invoice).total - paid);
}

/** "₹1,12,100 Dr" / "₹31,718 Cr" for a running balance. */
export const drCr = (paise: number) => (paise > 0 ? 'Dr' : paise < 0 ? 'Cr' : '');

/** GST included in an amount at `rate`% (₹1,180 at 18% → ₹180). */
export const gstIncluded = (amountPaise: number, rate: number) => (rate ? Math.round(amountPaise - amountPaise / (1 + rate / 100)) : 0);

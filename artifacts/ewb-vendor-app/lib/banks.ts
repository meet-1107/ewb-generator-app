import { IFSC_PATTERN } from '@/lib/domain';

/** Banks in India with the 4-letter IFSC prefix of each, for the bank picker. */
export const BANKS: { name: string; code: string }[] = [
  // Public sector
  { name: 'State Bank of India', code: 'SBIN' },
  { name: 'Punjab National Bank', code: 'PUNB' },
  { name: 'Bank of Baroda', code: 'BARB' },
  { name: 'Canara Bank', code: 'CNRB' },
  { name: 'Union Bank of India', code: 'UBIN' },
  { name: 'Bank of India', code: 'BKID' },
  { name: 'Indian Bank', code: 'IDIB' },
  { name: 'Central Bank of India', code: 'CBIN' },
  { name: 'Indian Overseas Bank', code: 'IOBA' },
  { name: 'UCO Bank', code: 'UCBA' },
  { name: 'Bank of Maharashtra', code: 'MAHB' },
  { name: 'Punjab & Sind Bank', code: 'PSIB' },
  // Private sector
  { name: 'HDFC Bank', code: 'HDFC' },
  { name: 'ICICI Bank', code: 'ICIC' },
  { name: 'Axis Bank', code: 'UTIB' },
  { name: 'Kotak Mahindra Bank', code: 'KKBK' },
  { name: 'IndusInd Bank', code: 'INDB' },
  { name: 'Yes Bank', code: 'YESB' },
  { name: 'IDFC FIRST Bank', code: 'IDFB' },
  { name: 'IDBI Bank', code: 'IBKL' },
  { name: 'Federal Bank', code: 'FDRL' },
  { name: 'South Indian Bank', code: 'SIBL' },
  { name: 'Karur Vysya Bank', code: 'KVBL' },
  { name: 'City Union Bank', code: 'CIUB' },
  { name: 'Karnataka Bank', code: 'KARB' },
  { name: 'RBL Bank', code: 'RATN' },
  { name: 'Bandhan Bank', code: 'BDBL' },
  { name: 'DCB Bank', code: 'DCBL' },
  { name: 'CSB Bank', code: 'CSBK' },
  { name: 'Tamilnad Mercantile Bank', code: 'TMBL' },
  { name: 'Jammu & Kashmir Bank', code: 'JAKA' },
  { name: 'Dhanlaxmi Bank', code: 'DLXB' },
  { name: 'Nainital Bank', code: 'NTBL' },
  // Small finance and payments banks
  { name: 'AU Small Finance Bank', code: 'AUBL' },
  { name: 'Equitas Small Finance Bank', code: 'ESFB' },
  { name: 'Ujjivan Small Finance Bank', code: 'UJVN' },
  { name: 'Jana Small Finance Bank', code: 'JSFB' },
  { name: 'Suryoday Small Finance Bank', code: 'SURY' },
  { name: 'Utkarsh Small Finance Bank', code: 'UTKS' },
  { name: 'ESAF Small Finance Bank', code: 'ESMF' },
  { name: 'Capital Small Finance Bank', code: 'CLBL' },
  { name: 'Shivalik Small Finance Bank', code: 'SMCB' },
  { name: 'Unity Small Finance Bank', code: 'UNBA' },
  { name: 'North East Small Finance Bank', code: 'NESF' },
  { name: 'Airtel Payments Bank', code: 'AIRP' },
  { name: 'India Post Payments Bank', code: 'IPOS' },
  { name: 'Fino Payments Bank', code: 'FINO' },
  { name: 'Jio Payments Bank', code: 'JIOP' },
  // Co-operative banks
  { name: 'Saraswat Co-operative Bank', code: 'SRCB' },
  { name: 'Cosmos Co-operative Bank', code: 'COSB' },
  { name: 'SVC Co-operative Bank', code: 'SVCB' },
  { name: 'TJSB Sahakari Bank', code: 'TJSB' },
  { name: 'NKGSB Co-operative Bank', code: 'NKGS' },
  { name: 'Abhyudaya Co-operative Bank', code: 'ABHY' },
  { name: 'Bharat Co-operative Bank (Mumbai)', code: 'BCBM' },
  { name: 'Janata Sahakari Bank (Pune)', code: 'JSBP' },
  { name: 'Kalupur Commercial Co-operative Bank', code: 'KCCB' },
  { name: 'Ahmedabad Mercantile Co-operative Bank', code: 'AMCB' },
  { name: 'Mehsana Urban Co-operative Bank', code: 'MSNU' },
  { name: 'Rajkot Nagarik Sahakari Bank', code: 'RNSB' },
  { name: 'Surat Peoples Co-operative Bank', code: 'SPCB' },
  { name: 'Gujarat State Co-operative Bank', code: 'GSCB' },
  // Foreign banks
  { name: 'Standard Chartered Bank', code: 'SCBL' },
  { name: 'HSBC', code: 'HSBC' },
  { name: 'Citibank', code: 'CITI' },
  { name: 'DBS Bank India', code: 'DBSS' },
  { name: 'Deutsche Bank', code: 'DEUT' },
  { name: 'Barclays Bank', code: 'BARC' },
];

/** The bank an IFSC belongs to, from its first four letters. */
export function bankForIfsc(ifsc: string) {
  return BANKS.find((bank) => bank.code === ifsc.slice(0, 4).toUpperCase());
}

export type IfscDetails = { bank: string; branch: string; city: string; state: string; address: string };

/**
 * Branch details for an IFSC from Razorpay's free, public IFSC API
 * (https://ifsc.razorpay.com). Returns null for an unknown IFSC; throws when offline.
 */
export async function lookupIfsc(raw: string): Promise<IfscDetails | null> {
  const ifsc = raw.trim().toUpperCase();
  if (!IFSC_PATTERN.test(ifsc)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`https://ifsc.razorpay.com/${ifsc}`, { signal: controller.signal });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`IFSC lookup failed (${response.status})`);
    const body = (await response.json()) as Record<string, unknown>;
    const text = (key: string) => (typeof body[key] === 'string' ? (body[key] as string).trim() : '');
    return { bank: text('BANK'), branch: text('BRANCH'), city: text('CITY'), state: text('STATE'), address: text('ADDRESS') };
  } finally {
    clearTimeout(timer);
  }
}

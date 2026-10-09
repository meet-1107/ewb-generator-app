/**
 * Plan catalogue. Prices and limits are placeholders until billing is
 * approved — override with PLANS_JSON. `sampleOnly` drives the client label.
 */

export type Plan = {
  id: string;
  name: string;
  pricePaise: number;
  cadence: "month" | "year";
  ewbLimit: number | null;
  gstins: number;
  users: number;
  features: string[];
};

const defaults: Plan[] = [
  { id: "free", name: "Starter", pricePaise: 0, cadence: "month", ewbLimit: 25, gstins: 1, users: 1, features: ["25 e-way bills / month", "Unlimited invoice drafts", "PDF import", "GST status"] },
  { id: "growth", name: "Growth", pricePaise: 49_900, cadence: "month", ewbLimit: 300, gstins: 3, users: 5, features: ["300 e-way bills / month", "3 GST registrations", "5 team members", "Priority support"] },
  { id: "business", name: "Business", pricePaise: 149_900, cadence: "month", ewbLimit: null, gstins: 20, users: 25, features: ["Unlimited e-way bills", "20 GST registrations", "25 team members", "Audit export"] },
];

export const plans: Plan[] = process.env["PLANS_JSON"] ? (JSON.parse(process.env["PLANS_JSON"]) as Plan[]) : defaults;
export const plansAreSamples = !process.env["PLANS_JSON"];
export const billingMode = process.env["BILLING_PROVIDER"] ?? "sandbox";

export function planById(id: string) {
  return plans.find((plan) => plan.id === id) ?? plans[0]!;
}

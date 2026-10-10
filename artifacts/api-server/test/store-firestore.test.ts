import { it } from "node:test";
import { storeContract } from "./store-contract";

// Runs against the Firestore emulator:
//   firebase emulators:exec --only firestore --project demo-ewb "pnpm --filter @workspace/api-server test"
if (process.env["FIRESTORE_EMULATOR_HOST"]) {
  process.env["STORE"] = "firestore";
  process.env["FIREBASE_PROJECT_ID"] ||= "demo-ewb";
  storeContract("firestore", () => import("../src/lib/store"));
} else {
  it("firestore store (skipped: FIRESTORE_EMULATOR_HOST is not set)", { skip: true }, () => {});
}

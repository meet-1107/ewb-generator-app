import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { storeContract } from "./store-contract";

process.env["DATA_DIR"] = mkdtempSync(path.join(tmpdir(), "ewb-store-"));
storeContract("file", () => import("../src/lib/store"));

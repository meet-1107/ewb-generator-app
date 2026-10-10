import { Router, type IRouter } from "express";
import healthRouter from "./health";
import ewbRouter from "./ewb";
import gstRouter from "./gst";
import pdfRouter from "./pdf";
import accountRouter from "./account";
import gstinRouter from "./gstin";
import distanceRouter from "./distance";
import authRouter from "./auth";
import adminPanelRouter from "./admin";
import { adminRouter, walletRouter } from "./wallet";
import { requireWorkspace } from "../lib/auth";

const router: IRouter = Router();

router.use(healthRouter);
router.use(adminRouter);
router.use(authRouter);
// The admin panel has its own sign-in check (admins only); mounted after the token-based /admin/wallet/topup.
router.use("/admin", adminPanelRouter);
router.use(requireWorkspace);
router.use(ewbRouter);
router.use(gstRouter);
router.use(pdfRouter);
router.use(accountRouter);
router.use(gstinRouter);
router.use(distanceRouter);
router.use(walletRouter);

export default router;

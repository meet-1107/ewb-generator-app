import { Router, type IRouter } from "express";
import healthRouter from "./health";
import ewbRouter from "./ewb";
import gstRouter from "./gst";
import pdfRouter from "./pdf";
import accountRouter from "./account";
import gstinRouter from "./gstin";
import { adminRouter, walletRouter } from "./wallet";
import { requireWorkspace } from "../lib/auth";

const router: IRouter = Router();

router.use(healthRouter);
router.use(adminRouter);
router.use(requireWorkspace);
router.use(ewbRouter);
router.use(gstRouter);
router.use(pdfRouter);
router.use(accountRouter);
router.use(gstinRouter);
router.use(walletRouter);

export default router;

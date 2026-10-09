import { Router, type IRouter } from "express";
import healthRouter from "./health";
import ewbRouter from "./ewb";
import gstRouter from "./gst";
import pdfRouter from "./pdf";
import accountRouter from "./account";
import { requireWorkspace } from "../lib/auth";

const router: IRouter = Router();

router.use(healthRouter);
router.use(requireWorkspace);
router.use(ewbRouter);
router.use(gstRouter);
router.use(pdfRouter);
router.use(accountRouter);

export default router;

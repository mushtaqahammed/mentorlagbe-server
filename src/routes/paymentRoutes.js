import { Router } from "express";
import { recordPayment } from "../controllers/paymentController.js";

const router = Router();

router.post("/internal/payments", recordPayment);

export default router;

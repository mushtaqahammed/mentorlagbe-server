import { Router } from "express";
import {
  applySubscription,
  getSubscriptionBySession,
  getSubscriptionState,
} from "../controllers/subscriptionController.js";

const router = Router();

router.get("/internal/subscription-by-session", getSubscriptionBySession);
router.get("/internal/subscription-state", getSubscriptionState);
router.post("/internal/subscriptions/apply", applySubscription);

export default router;

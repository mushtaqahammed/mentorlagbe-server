import { subscriptionsCollection } from "../config/database.js";
import {
  requireInternalIdentity,
  requireInternalService,
} from "../middleware/internalAuth.js";
import {
  applySubscriptionState,
  getSubscriptionStateFromDb,
} from "../services/subscriptionService.js";
import { asString, toIsoStringOrNull } from "../utils/helpers.js";

export async function getSubscriptionBySession(req, res) {
  try {
    if (!requireInternalService(req, res)) return;

    const stripeSessionId = asString(req.query.stripeSessionId).trim();
    if (!stripeSessionId) return res.json(null);

    const record = await subscriptionsCollection.findOne(
      { stripeSessionId },
      { sort: { updatedAt: -1 } },
    );
    if (!record) return res.json(null);

    res.json({
      userId: asString(record.userId),
      isPro: record.isPro === true,
      status: asString(record.status, "none"),
      stripeSubscriptionId: asString(record.stripeSubscriptionId),
      stripeCustomerId: asString(record.stripeCustomerId),
      currentPeriodStart: toIsoStringOrNull(record.currentPeriodStart),
      currentPeriodEnd: toIsoStringOrNull(record.currentPeriodEnd),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
}

export async function getSubscriptionState(req, res) {
  try {
    const user = await requireInternalIdentity(req, res, "x-user-id", null);
    if (!user) return;

    res.json(await getSubscriptionStateFromDb(user.id));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
}

export async function applySubscription(req, res) {
  try {
    if (!requireInternalService(req, res)) return;

    const payload = req.body || {};
    const callerId = String(req.headers["x-user-id"] || "").trim();
    if (callerId && callerId !== String(payload.userId || "")) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const state = await applySubscriptionState(payload);
    if (!state) {
      return res.status(404).json({ error: "Account not found" });
    }

    res.json(state);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
}

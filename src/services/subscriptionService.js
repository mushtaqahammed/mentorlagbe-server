import { subscriptionsCollection, usersCollection } from "../config/database.js";
import { findUserById } from "./userService.js";
import {
  asString,
  toDateOrNull,
  toIsoStringOrNull,
} from "../utils/helpers.js";

export const PRO_PLANS = {
  "pro-tutor": { id: "pro-tutor", name: "Pro Tutor", price: 15 },
  "pro-student": { id: "pro-student", name: "Pro Student", price: 10 },
};
export const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["active", "trialing"]);

export function getPlanById(id) {
  return PRO_PLANS[asString(id)] || null;
}

export function getPlanForRole(role) {
  const normalized = asString(role)
    .trim()
    .toLowerCase();
  if (normalized === "tutor") return PRO_PLANS["pro-tutor"];
  if (normalized === "student") return PRO_PLANS["pro-student"];
  return null;
}

export function serializeSubscriptionState(record) {
  const status = asString(record?.status, "none");
  const isPro =
    record?.isPro === true &&
    ACTIVE_SUBSCRIPTION_STATUSES.has(status.toLowerCase());
  const planId = getPlanById(asString(record?.planId))?.id || null;
  const base = {
    plan: "free",
    isPro: false,
    status,
    planId: null,
    stripeSubscriptionId: null,
    stripeCustomerId: null,
    currentPeriodStart: null,
    currentPeriodEnd: null,
  };

  if (!isPro) return base;

  return {
    plan: "pro",
    isPro: true,
    status,
    planId,
    stripeSubscriptionId: asString(record.stripeSubscriptionId) || null,
    stripeCustomerId: asString(record.stripeCustomerId) || null,
    currentPeriodStart: toIsoStringOrNull(record.currentPeriodStart),
    currentPeriodEnd: toIsoStringOrNull(record.currentPeriodEnd),
  };
}

export async function getSubscriptionStateFromDb(userId) {
  const record = await subscriptionsCollection.findOne(
    { userId: String(userId) },
    { sort: { updatedAt: -1 } },
  );
  return serializeSubscriptionState(record);
}

export async function applySubscriptionState(payload) {
  const userId = String(payload.userId || "").trim();
  if (!userId) return null;

  const user = await findUserById(userId);
  if (!user) return null;

  const mode = asString(payload.mode);
  const now = new Date();
  const nowIso = now.toISOString();
  const status = asString(payload.status, "none");
  const stripeSubscriptionId = asString(payload.stripeSubscriptionId);
  const stripeCustomerId = asString(payload.stripeCustomerId);
  const stripeSessionId = asString(payload.stripeSessionId);
  const currentPeriodStart = toDateOrNull(payload.currentPeriodStart);
  const currentPeriodEnd = toDateOrNull(payload.currentPeriodEnd);

  if (mode === "inactive") {
    const subscriptionSet = {
      isPro: false,
      status,
      updatedAt: now,
    };
    if (stripeSubscriptionId) {
      subscriptionSet.stripeSubscriptionId = stripeSubscriptionId;
    }

    const userSet = {
      plan: "free",
      subscriptionStatus: status,
    };
    if (stripeSubscriptionId) {
      userSet.stripeSubscriptionId = stripeSubscriptionId;
    }

    await Promise.all([
      subscriptionsCollection.updateOne(
        { userId },
        [{ $set: subscriptionSet }, { $unset: ["activatedAt"] }],
        { upsert: true },
      ),
      usersCollection.updateOne({ _id: user._id }, [
        { $set: userSet },
        {
          $unset: [
            "proPlanId",
            "proActivatedAt",
            "subscriptionStartDate",
            "subscriptionEndDate",
          ],
        },
      ]),
    ]);

    return getSubscriptionStateFromDb(userId);
  }

  if (mode !== "grant") return null;

  const planId = getPlanById(payload.planId)?.id;
  if (!planId) return null;

  const subscriptionSet = {
    userId,
    planId,
    isPro: true,
    status,
    stripeSubscriptionId,
    currentPeriodStart,
    currentPeriodEnd,
    updatedAt: now,
  };
  if (stripeSessionId) subscriptionSet.stripeSessionId = stripeSessionId;
  if (stripeCustomerId) subscriptionSet.stripeCustomerId = stripeCustomerId;

  const userSet = {
    plan: "pro",
    subscriptionStatus: status,
    proPlanId: planId,
    stripeSubscriptionId,
    subscriptionStartDate: currentPeriodStart?.toISOString() ?? null,
    subscriptionEndDate: currentPeriodEnd?.toISOString() ?? null,
    proActivatedAt: { $ifNull: ["$proActivatedAt", nowIso] },
  };
  if (stripeCustomerId) userSet.stripeCustomerId = stripeCustomerId;

  await Promise.all([
    subscriptionsCollection.updateOne(
      { userId },
      [
        {
          $set: {
            ...subscriptionSet,
            createdAt: { $ifNull: ["$createdAt", now] },
            activatedAt: { $ifNull: ["$activatedAt", now] },
          },
        },
      ],
      { upsert: true },
    ),
    usersCollection.updateOne({ _id: user._id }, [{ $set: userSet }]),
  ]);

  return getSubscriptionStateFromDb(userId);
}

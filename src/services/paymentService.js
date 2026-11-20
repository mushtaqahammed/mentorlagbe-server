import {
  database,
  paymentsCollection,
  usersCollection,
} from "../config/database.js";
import {
  asString,
  combine,
  escapeRegExp,
  formatMoney,
  toDateOrNull,
  toIsoStringOrNull,
  toUserObjectId,
} from "../utils/helpers.js";
import {
  PRO_PLANS,
  getPlanById,
  getPlanForRole,
} from "./subscriptionService.js";

export const ADMIN_TRANSACTION_ROLES = new Set(["tutor", "student"]);
export const ADMIN_TRANSACTION_PLANS = new Set(["pro-tutor", "pro-student"]);

const PAYMENT_SUCCESS_STATUSES =
  /^(succeeded|success|paid|completed|complete)$/i;
const PAYMENT_FAILURE_STATUSES =
  /^(failed|failure|pending|incomplete|incomplete_expired|canceled|cancelled|refunded|reversed)$/i;
const STRIPE_PROVIDER = /^stripe$/i;
const ONE_TIME_PAYMENT_MODE = /^(payment|one[_-]?time)$/i;
const SUCCESS_STATUS_FIELDS = ["status", "paymentStatus", "payment_status"];
const PROVIDER_FIELDS = [
  "provider",
  "paymentProvider",
  "payment_provider",
  "gateway",
  "processor",
];

export async function getPaymentsCollectionForStats() {
  const existing = await database
    .listCollections({}, { nameOnly: true })
    .toArray();
  const name = ["payments", "payment"].find((candidate) =>
    existing.some((collection) => collection.name === candidate),
  );
  return name ? database.collection(name) : paymentsCollection;
}

let paymentsSetupPromise = null;

export function ensurePaymentsCollection() {
  if (!paymentsSetupPromise) {
    paymentsSetupPromise = (async () => {
      const existing = await database
        .listCollections({ name: "payments" }, { nameOnly: true })
        .toArray();

      if (existing.length === 0) {
        try {
          await database.createCollection("payments");
        } catch (error) {
          // A concurrent startup may have created it first.
          if (error?.code !== 48) throw error;
        }
      }

      await paymentsCollection.createIndex(
        { stripeSessionId: 1 },
        {
          name: "stripeSessionId_unique",
          unique: true,
          partialFilterExpression: { stripeSessionId: { $type: "string" } },
        },
      );
    })().catch((error) => {
      paymentsSetupPromise = null;
      console.error("Could not prepare the payments collection:", error);
    });
  }

  return paymentsSetupPromise;
}

export async function recordSubscriptionPayment(payload) {
  const sessionId = asString(payload.stripeSessionId).trim();
  if (!sessionId) return;

  await ensurePaymentsCollection();

  const plan = getPlanById(payload.planId);
  const fallbackAmountMinor = (plan?.price ?? 0) * 100;
  const rawAmount = Number(payload.amountMinor);
  const safeAmountMinor =
    Number.isFinite(rawAmount) && rawAmount >= 0
      ? Math.round(rawAmount)
      : fallbackAmountMinor;
  const now = new Date();

  try {
    await paymentsCollection.updateOne(
      { stripeSessionId: sessionId },
      {
        $setOnInsert: {
          userId: String(payload.userId || ""),
          userEmail: asString(payload.userEmail),
          userRole: asString(payload.userRole),
          planId: asString(payload.planId),
          planName: asString(payload.planName, plan?.name || ""),
          amount: safeAmountMinor / 100,
          amountMinor: safeAmountMinor,
          amountInMinorUnits: false,
          currency: asString(payload.currency, "usd").toUpperCase(),
          status: asString(payload.paymentStatus, "paid"),
          paymentStatus: asString(payload.paymentStatus, "paid"),
          provider: "stripe",
          mode: "subscription",
          type: "subscription",
          stripeSessionId: sessionId,
          stripeSubscriptionId: asString(payload.stripeSubscriptionId),
          stripeCustomerId: asString(payload.stripeCustomerId),
          currentPeriodStart: toDateOrNull(payload.currentPeriodStart),
          currentPeriodEnd: toDateOrNull(payload.currentPeriodEnd),
          paidAt: now,
          createdAt: now,
        },
      },
      { upsert: true },
    );
  } catch (error) {
    // A concurrent confirm/webhook request may have inserted this already.
    if (error?.code !== 11000) {
      console.error("Could not record the Stripe payment:", error);
    }
  }
}

export function verifiedPaymentConditions() {
  return [
    { stripeSessionId: { $type: "string" } },
    {
      $or: SUCCESS_STATUS_FIELDS.map((field) => ({
        [field]: PAYMENT_SUCCESS_STATUSES,
      })),
    },
    {
      $nor: SUCCESS_STATUS_FIELDS.map((field) => ({
        [field]: PAYMENT_FAILURE_STATUSES,
      })),
    },
    {
      $nor: [
        { mode: ONE_TIME_PAYMENT_MODE },
        { type: ONE_TIME_PAYMENT_MODE },
      ],
    },
    {
      $or: [
        ...PROVIDER_FIELDS.map((field) => ({ [field]: STRIPE_PROVIDER })),
        {
          $and: [
            ...PROVIDER_FIELDS.map((field) => ({ [field]: { $exists: false } })),
            { stripeSubscriptionId: { $type: "string" } },
          ],
        },
      ],
    },
  ];
}

export function buildRoleConditions(role) {
  if (role === "all" || !ADMIN_TRANSACTION_ROLES.has(role)) return [];
  return [{ userRole: new RegExp(`^${escapeRegExp(role)}$`, "i") }];
}

export function buildPlanConditions(plan) {
  if (plan === "all" || !ADMIN_TRANSACTION_PLANS.has(plan)) return [];

  const config = getPlanById(plan);
  const matches = [{ planId: new RegExp(`^${escapeRegExp(plan)}$`, "i") }];
  if (config) {
    matches.push({
      planName: new RegExp(`^${escapeRegExp(config.name)}$`, "i"),
    });
  }
  return [{ $or: matches }];
}

export async function buildSearchConditions(search) {
  const term = asString(search).trim().slice(0, 100);
  if (!term) return [];

  const pattern = new RegExp(escapeRegExp(term), "i");
  const users = await usersCollection
    .find(
      { $or: [{ name: pattern }, { email: pattern }] },
      { projection: { _id: 1 } },
    )
    .limit(500)
    .toArray();

  const matches = [
    { userEmail: pattern },
    { stripeSessionId: pattern },
    { stripeSubscriptionId: pattern },
    { stripeCustomerId: pattern },
  ];

  if (users.length > 0) {
    matches.push({ userId: { $in: users.map((user) => String(user._id)) } });
  }

  return [{ $or: matches }];
}

export async function getTransactionUsers(userIds) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0) return new Map();

  const users = await usersCollection
    .find(
      { _id: { $in: ids.map(toUserObjectId) } },
      { projection: { name: 1, email: 1, role: 1, proPlanId: 1 } },
    )
    .toArray();

  return new Map(
    users.map((user) => [
      String(user._id),
      {
        name: asString(user.name),
        email: asString(user.email),
        role: asString(user.role),
        planId: asString(user.proPlanId),
      },
    ]),
  );
}

function resolvePlan(payment, user, role) {
  const storedPlan = getPlanById(asString(payment.planId));
  if (storedPlan) return storedPlan;

  const storedName = asString(payment.planName);
  if (/tutor/i.test(storedName)) return PRO_PLANS["pro-tutor"];
  if (/student/i.test(storedName)) return PRO_PLANS["pro-student"];

  const userPlan = getPlanById(user?.planId);
  if (userPlan) return userPlan;

  return getPlanForRole(role) || PRO_PLANS["pro-student"];
}

function normalizeTransactionRole(value) {
  const role = asString(value)
    .trim()
    .toLowerCase();
  return ADMIN_TRANSACTION_ROLES.has(role) ? role : null;
}

function toMajorAmount(payment) {
  const storedMinor = Number(payment.amountMinor);
  const storedAmount = Number(payment.amount);

  if (payment.amountInMinorUnits === true) {
    if (Number.isFinite(storedMinor)) return storedMinor / 100;
    if (Number.isFinite(storedAmount)) return storedAmount;
  } else {
    if (Number.isFinite(storedAmount)) return storedAmount;
    if (Number.isFinite(storedMinor)) return storedMinor / 100;
  }

  return 0;
}

function normalizeCurrency(value, fallback = "USD") {
  const currency = asString(value).toUpperCase();
  return /^[A-Z]{3}$/.test(currency) ? currency : fallback;
}

export function serializeTransaction(payment, users) {
  const userId = asString(payment.userId);
  const user = users.get(userId);
  const storedRole =
    normalizeTransactionRole(payment.userRole) ||
    normalizeTransactionRole(user?.role);
  const plan = resolvePlan(payment, user, storedRole);
  const role = storedRole || (plan.id === "pro-tutor" ? "tutor" : "student");
  const email = asString(payment.userEmail) || user?.email || "";
  const amount = toMajorAmount(payment);
  const currency = normalizeCurrency(payment.currency);
  const stripeSessionId = asString(payment.stripeSessionId);
  const stripeSubscriptionId = asString(payment.stripeSubscriptionId) || null;

  return {
    id: String(payment._id),
    userId,
    userName: user?.name || email || "Unnamed user",
    email,
    role,
    planId: plan.id,
    planName: asString(payment.planName) || plan.name,
    amount,
    currency,
    amountFormatted: formatMoney(amount, currency, "en-US", "USD"),
    transactionId:
      stripeSessionId ||
      stripeSubscriptionId ||
      asString(payment.stripeCustomerId) ||
      String(payment._id),
    stripeSessionId,
    stripeSubscriptionId,
    paymentDate:
      toIsoStringOrNull(payment.paidAt) ||
      toIsoStringOrNull(payment.createdAt) ||
      toIsoStringOrNull(payment.currentPeriodStart),
  };
}

function buildTransactionRevenuePipeline() {
  const amountFromMajor = {
    $convert: {
      input: "$amount",
      to: "double",
      onError: null,
      onNull: null,
    },
  };
  const amountFromMinor = {
    $divide: [
      {
        $convert: {
          input: "$amountMinor",
          to: "double",
          onError: null,
          onNull: 0,
        },
      },
      100,
    ],
  };

  return [
    { $match: combine(verifiedPaymentConditions()) },
    {
      $addFields: {
        _amount: {
          $cond: [
            { $eq: ["$amountInMinorUnits", true] },
            amountFromMinor,
            { $ifNull: [amountFromMajor, amountFromMinor] },
          ],
        },
        _currency: { $toUpper: { $ifNull: ["$currency", "USD"] } },
      },
    },
    {
      $group: {
        _id: null,
        total: { $sum: "$_amount" },
        currencies: { $addToSet: "$_currency" },
      },
    },
  ];
}

export async function getTransactionSummary() {
  const verified = combine(verifiedPaymentConditions());

  const [total, tutorCount, studentCount, revenueResult] = await Promise.all([
    paymentsCollection.countDocuments(verified),
    paymentsCollection.countDocuments(
      combine([...verifiedPaymentConditions(), ...buildRoleConditions("tutor")]),
    ),
    paymentsCollection.countDocuments(
      combine([
        ...verifiedPaymentConditions(),
        ...buildRoleConditions("student"),
      ]),
    ),
    paymentsCollection.aggregate(buildTransactionRevenuePipeline()).toArray(),
  ]);

  const summary = revenueResult[0];
  const amount = Number.isFinite(summary?.total) ? summary.total : 0;
  const currency =
    summary?.currencies.find((code) => /^[A-Z]{3}$/.test(code)) || "USD";

  return {
    total,
    tutorCount,
    studentCount,
    revenue: {
      amount,
      currency,
      formatted: formatMoney(amount, currency, "en-US", "USD"),
    },
  };
}

function buildStatsRevenuePipeline() {
  return [
    {
      $match: {
        $and: [
          {
            $or: [
              ...PROVIDER_FIELDS.map((field) => ({ [field]: STRIPE_PROVIDER })),
              {
                $and: PROVIDER_FIELDS.map((field) => ({
                  [field]: { $exists: false },
                })),
              },
            ],
          },
          {
            $or: SUCCESS_STATUS_FIELDS.map((field) => ({
              [field]: PAYMENT_SUCCESS_STATUSES,
            })),
          },
          {
            $nor: SUCCESS_STATUS_FIELDS.map((field) => ({
              [field]: PAYMENT_FAILURE_STATUSES,
            })),
          },
          {
            $nor: [
              { mode: ONE_TIME_PAYMENT_MODE },
              { type: ONE_TIME_PAYMENT_MODE },
            ],
          },
        ],
      },
    },
    {
      $project: {
        amount: {
          $let: {
            vars: {
              rawAmount: {
                $ifNull: [
                  "$amount",
                  "$amountMajor",
                  "$amountTotal",
                  "$amount_total",
                  "$amountReceived",
                  "$amount_received",
                  "$total",
                  0,
                ],
              },
              divisor: {
                $cond: [
                  { $eq: [{ $toBool: "$amountInMinorUnits" }, true] },
                  100,
                  1,
                ],
              },
            },
            in: {
              $divide: [
                {
                  $convert: {
                    input: "$$rawAmount",
                    to: "double",
                    onError: 0,
                    onNull: 0,
                  },
                },
                "$$divisor",
              ],
            },
          },
        },
        currency: {
          $toUpper: { $toString: { $ifNull: ["$currency", "BDT"] } },
        },
      },
    },
    {
      $group: {
        _id: null,
        total: { $sum: "$amount" },
        currencies: { $addToSet: "$currency" },
      },
    },
  ];
}

export async function getStatsRevenue() {
  const payments = await getPaymentsCollectionForStats();
  const empty = {
    amount: 0,
    currency: "BDT",
    formatted: formatMoney(0, "BDT", "en-BD", "BDT"),
  };
  const [summary] = await payments
    .aggregate(buildStatsRevenuePipeline())
    .toArray();
  const amount = Number.isFinite(summary?.total) ? summary.total : 0;
  const currency =
    summary?.currencies.find((code) => /^[A-Z]{3}$/.test(code)) || "BDT";

  return {
    amount,
    currency,
    formatted: formatMoney(amount, currency, "en-BD", "BDT"),
  };
}

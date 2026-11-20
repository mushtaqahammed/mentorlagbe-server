import { ObjectId } from "mongodb";
import {
  paymentsCollection,
  tuitionsCollection,
  usersCollection,
} from "../config/database.js";
import { requireInternalIdentity } from "../middleware/internalAuth.js";
import {
  ADMIN_TRANSACTION_ROLES,
  buildPlanConditions,
  buildRoleConditions,
  buildSearchConditions,
  ensurePaymentsCollection,
  getStatsRevenue,
  getTransactionSummary,
  getTransactionUsers,
  serializeTransaction,
  verifiedPaymentConditions,
} from "../services/paymentService.js";
import {
  asString,
  combine,
  escapeRegExp,
  parseInteger,
  toIsoStringOrNull,
} from "../utils/helpers.js";
import {
  ADMIN_TUITION_STATUSES,
  ADMIN_TUITION_STATUS_VALUES,
  buildAdminTuitionFilter,
  serializeAdminTuition,
} from "../utils/tuition.js";

const ADMIN_USER_ROLE_VALUES = {
  student: "Student",
  tutor: "Tutor",
  admin: "Admin",
};
const ADMIN_USER_ROLES = new Set(Object.keys(ADMIN_USER_ROLE_VALUES));

function normalizeAdminUserRole(value) {
  const role = asString(value)
    .trim()
    .toLowerCase();
  return ADMIN_USER_ROLES.has(role) ? role : "student";
}

function serializeAdminUser(user) {
  const email = asString(user.email);
  const name = asString(user.name).trim() || email || "Unnamed user";
  const image = asString(user.image).trim();

  return {
    id: String(user._id),
    name,
    email,
    image: image || null,
    role: normalizeAdminUserRole(user.role),
    createdAt: toIsoStringOrNull(user.createdAt),
  };
}

function buildUserFilter(search, role) {
  const filter = {};
  const term = asString(search).trim().slice(0, 100);

  if (term) {
    const pattern = new RegExp(escapeRegExp(term), "i");
    filter.$or = [{ name: pattern }, { email: pattern }];
  }

  if (role !== "all" && ADMIN_USER_ROLES.has(role)) {
    filter.role = new RegExp(`^${ADMIN_USER_ROLE_VALUES[role]}$`, "i");
  }

  return filter;
}

async function getTutorIdentities(tutorIds) {
  const validIds = [
    ...new Set(
      tutorIds.filter((id) => Boolean(id) && ObjectId.isValid(String(id))),
    ),
  ];
  if (validIds.length === 0) return new Map();

  const tutors = await usersCollection
    .find(
      { _id: { $in: validIds.map((id) => new ObjectId(String(id))) } },
      { projection: { name: 1, email: 1 } },
    )
    .toArray();

  return new Map(
    tutors.map((tutor) => [
      String(tutor._id),
      {
        name: asString(tutor.name).trim() || "Tutor",
        email: asString(tutor.email),
      },
    ]),
  );
}

async function getStatsTuitionCounts() {
  const summary = await tuitionsCollection
    .aggregate([
      {
        $match: {
          $or: [
            { approvalStatus: /^pending$/i },
            { approvalStatus: /^approved$/i },
          ],
        },
      },
      {
        $group: {
          _id: { $toLower: { $ifNull: ["$approvalStatus", ""] } },
          count: { $sum: 1 },
        },
      },
    ])
    .toArray();

  const counts = new Map(summary.map((item) => [item._id, item.count]));
  return {
    pending: counts.get("pending") || 0,
    approved: counts.get("approved") || 0,
  };
}

export async function getAdminUsers(req, res) {
  try {
    const admin = await requireInternalIdentity(req, res, "x-admin-id", [
      "admin",
    ]);
    if (!admin) return;

    const filter = buildUserFilter(
      asString(req.query.search),
      asString(req.query.role, "all"),
    );
    const limit = parseInteger(req.query.limit, 8, 1, 50);
    const requestedPage = parseInteger(req.query.page, 1, 1, 100000);

    const [totalUsers, total] = await Promise.all([
      usersCollection.countDocuments({}),
      usersCollection.countDocuments(filter),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / limit));
    const page = Math.min(requestedPage, totalPages);
    const docs =
      total === 0
        ? []
        : await usersCollection
            .find(filter, {
              projection: {
                name: 1,
                email: 1,
                image: 1,
                role: 1,
                createdAt: 1,
              },
            })
            .sort({ createdAt: -1, _id: -1 })
            .skip((page - 1) * limit)
            .limit(limit)
            .toArray();

    res.json({
      users: docs.map(serializeAdminUser),
      total,
      totalUsers,
      page,
      totalPages,
      limit,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
}

export async function updateAdminUserRole(req, res) {
  try {
    const admin = await requireInternalIdentity(req, res, "x-admin-id", [
      "admin",
    ]);
    if (!admin) return;

    const id = String(req.params.id || "");
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid user ID." });
    }
    if (id.toLowerCase() === admin.id.toLowerCase()) {
      return res.status(403).json({ error: "You cannot change your own role." });
    }

    const role = asString(req.body?.role)
      .trim()
      .toLowerCase();
    if (!ADMIN_USER_ROLES.has(role)) {
      return res
        .status(400)
        .json({ error: "Role must be student, tutor, or admin." });
    }

    const result = await usersCollection.findOneAndUpdate(
      { _id: new ObjectId(id) },
      {
        $set: {
          role: ADMIN_USER_ROLE_VALUES[role],
          updatedAt: new Date(),
        },
      },
      { returnDocument: "after", includeResultMetadata: true },
    );

    if (!result.value) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({ user: serializeAdminUser(result.value) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
}

export async function getAdminTuitions(req, res) {
  try {
    const admin = await requireInternalIdentity(req, res, "x-admin-id", [
      "admin",
    ]);
    if (!admin) return;

    const search = asString(req.query.search);
    const subject = asString(req.query.subject);
    const status = asString(req.query.status, "all");
    const filter = buildAdminTuitionFilter(search, subject, status);
    const limit = parseInteger(req.query.limit, 6, 1, 50);
    const requestedPage = parseInteger(req.query.page, 1, 1, 100000);

    const statusValues = ["all", ...ADMIN_TUITION_STATUSES];
    const [countsResult, total, totalTuitions] = await Promise.all([
      Promise.all(
        statusValues.map(async (value) => ({
          value,
          count: await tuitionsCollection.countDocuments(
            buildAdminTuitionFilter(search, subject, value),
          ),
        })),
      ),
      tuitionsCollection.countDocuments(filter),
      tuitionsCollection.countDocuments({}),
    ]);

    const counts = Object.fromEntries(
      countsResult.map(({ value, count }) => [value, count]),
    );
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const page = Math.min(requestedPage, totalPages);
    const direction =
      asString(req.query.sort).toLowerCase() === "oldest" ? 1 : -1;

    const docs =
      total === 0
        ? []
        : await tuitionsCollection
            .find(filter)
            .sort({ createdAt: direction, _id: direction })
            .skip((page - 1) * limit)
            .limit(limit)
            .toArray();

    const tutors = await getTutorIdentities(
      docs.map((tuition) => asString(tuition.tutorId)),
    );

    res.json({
      tuitions: docs.map((tuition) => serializeAdminTuition(tuition, tutors)),
      total,
      counts,
      totalTuitions,
      page,
      totalPages,
      limit,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
}

export async function updateAdminTuitionApproval(req, res) {
  try {
    const admin = await requireInternalIdentity(req, res, "x-admin-id", [
      "admin",
    ]);
    if (!admin) return;

    const id = String(req.params.id || "");
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid tuition ID." });
    }

    const status = asString(req.body?.status)
      .trim()
      .toLowerCase();
    if (status !== "approved" && status !== "rejected") {
      return res
        .status(400)
        .json({ error: "Status must be approved or rejected." });
    }

    const result = await tuitionsCollection.findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: { approvalStatus: ADMIN_TUITION_STATUS_VALUES[status] } },
      { returnDocument: "after", includeResultMetadata: true },
    );

    if (!result.value) {
      return res.status(404).json({ error: "Tuition not found" });
    }

    const tutors = await getTutorIdentities([asString(result.value.tutorId)]);

    res.json({ tuition: serializeAdminTuition(result.value, tutors) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
}

export async function getAdminStats(req, res) {
  try {
    const admin = await requireInternalIdentity(req, res, "x-admin-id", [
      "admin",
    ]);
    if (!admin) return;

    const [totalUsers, totalTutors, tuitionCounts, stripeRevenue] =
      await Promise.all([
        usersCollection.countDocuments({}),
        usersCollection.countDocuments({ role: /^tutor$/i }),
        getStatsTuitionCounts(),
        getStatsRevenue(),
      ]);

    res.json({
      totalUsers,
      totalTutors,
      pendingTuitions: tuitionCounts.pending,
      approvedTuitions: tuitionCounts.approved,
      stripeRevenue,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
}

export async function getAdminTransactions(req, res) {
  try {
    const admin = await requireInternalIdentity(req, res, "x-admin-id", [
      "admin",
    ]);
    if (!admin) return;

    await ensurePaymentsCollection();

    const searchConditions = await buildSearchConditions(
      asString(req.query.search),
    );
    const planConditions = buildPlanConditions(asString(req.query.plan, "all"));
    const roleFilter = asString(req.query.role, "all");
    const baseConditions = [
      ...verifiedPaymentConditions(),
      ...searchConditions,
      ...planConditions,
    ];
    const filter = combine([
      ...baseConditions,
      ...buildRoleConditions(roleFilter),
    ]);
    const limit = parseInteger(req.query.limit, 8, 1, 50);
    const requestedPage = parseInteger(req.query.page, 1, 1, 100000);

    const roleValues = ["all", ...ADMIN_TRANSACTION_ROLES];
    const [total, ...roleCounts] = await Promise.all([
      paymentsCollection.countDocuments(filter),
      ...roleValues.map((value) =>
        paymentsCollection.countDocuments(
          combine([...baseConditions, ...buildRoleConditions(value)]),
        ),
      ),
    ]);

    const counts = Object.fromEntries(
      roleValues.map((value, index) => [value, roleCounts[index] || 0]),
    );
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const page = Math.min(requestedPage, totalPages);

    const docs =
      total === 0
        ? []
        : await paymentsCollection
            .find(filter)
            .sort({ paidAt: -1, createdAt: -1, _id: -1 })
            .skip((page - 1) * limit)
            .limit(limit)
            .toArray();

    const users = await getTransactionUsers(
      docs.map((payment) => asString(payment.userId)),
    );

    res.json({
      transactions: docs.map((payment) => serializeTransaction(payment, users)),
      total,
      counts,
      summary: await getTransactionSummary(),
      page,
      totalPages,
      limit,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
}

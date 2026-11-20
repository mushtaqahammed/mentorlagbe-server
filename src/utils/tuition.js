import { asString, escapeRegExp, toIsoStringOrNull } from "./helpers.js";

export const ADMIN_TUITION_STATUS_VALUES = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
};
export const ADMIN_TUITION_STATUSES = new Set(
  Object.keys(ADMIN_TUITION_STATUS_VALUES),
);

export function serializeTuition(tuition) {
  const fallbackDate = tuition._id?.getTimestamp
    ? tuition._id.getTimestamp()
    : new Date();

  return {
    id: tuition._id.toString(),
    tutorId: tuition.tutorId || "",
    title: tuition.title || "",
    subject: tuition.subject || "",
    classLevel: tuition.classLevel || "",
    mode: tuition.mode || "Online",
    location: tuition.location || "",
    monthlyFee: tuition.monthlyFee || 0,
    daysPerWeek: tuition.daysPerWeek || 0,
    description: tuition.description || "",
    bannerImage: tuition.bannerImage || "",
    approvalStatus: tuition.approvalStatus || "Pending",
    status: tuition.status || "Active",
    createdAt: tuition.createdAt || fallbackDate,
    updatedAt: tuition.updatedAt || null,
  };
}

// Public pages only show active AND approved posts. Older posts without a
// status are treated as active, matching the fallback used in
// serializeTuition(). A missing approvalStatus is treated as pending, so it
// never becomes publicly visible. The comparison is case-insensitive because
// older records may use lowercase values.
export const activeTuitionFilter = {
  approvalStatus: /^approved$/i,
  $or: [{ status: "Active" }, { status: { $exists: false } }, { status: null }],
};

export const editableFields = [
  "title",
  "subject",
  "classLevel",
  "mode",
  "location",
  "monthlyFee",
  "daysPerWeek",
  "description",
  "bannerImage",
];

export function normalizeApprovalStatus(value) {
  const status = asString(value)
    .trim()
    .toLowerCase();
  return ADMIN_TUITION_STATUSES.has(status) ? status : "pending";
}

export function normalizeLifecycleStatus(value) {
  return asString(value).trim().toLowerCase() === "closed" ? "closed" : "active";
}

export function serializeAdminTuition(tuition, tutors) {
  const tutorId = asString(tuition.tutorId);
  const identity = tutors.get(tutorId);
  const storedTutorName = asString(tuition.tutorName).trim();
  const storedTutorEmail = asString(tuition.tutorEmail).trim();
  const bannerImage = asString(tuition.bannerImage).trim();

  return {
    id: String(tuition._id),
    tutorId,
    tutorName: storedTutorName || identity?.name || "Tutor",
    tutorEmail: storedTutorEmail || identity?.email || "",
    title: asString(tuition.title),
    subject: asString(tuition.subject),
    classLevel: asString(tuition.classLevel),
    mode: asString(tuition.mode, "Online"),
    location: asString(tuition.location),
    monthlyFee: Number(tuition.monthlyFee || 0),
    daysPerWeek: Number(tuition.daysPerWeek || 0),
    description: asString(tuition.description),
    bannerImage: bannerImage || null,
    approvalStatus: normalizeApprovalStatus(tuition.approvalStatus),
    status: normalizeLifecycleStatus(tuition.status),
    createdAt: toIsoStringOrNull(tuition.createdAt),
    updatedAt: toIsoStringOrNull(tuition.updatedAt),
  };
}

export function serializeFeaturedTuition(tuition, tutorNames) {
  const tutorId = asString(tuition.tutorId);
  const storedName = asString(tuition.tutorName).trim();
  const bannerImage = asString(tuition.bannerImage).trim();

  return {
    id: String(tuition._id),
    title: asString(tuition.title),
    subject: asString(tuition.subject),
    classLevel: asString(tuition.classLevel),
    mode: asString(tuition.mode, "Online"),
    location: asString(tuition.location),
    description: asString(tuition.description),
    monthlyFee: Number(tuition.monthlyFee || 0),
    daysPerWeek: Number(tuition.daysPerWeek || 0),
    bannerImage: bannerImage || null,
    tutorName: storedName || tutorNames.get(tutorId) || "Tutor",
    status: normalizeLifecycleStatus(tuition.status),
    createdAt: toIsoStringOrNull(tuition.createdAt),
  };
}

export function buildAdminTuitionFilter(search, subject, status) {
  const filter = {};
  const term = asString(search).trim().slice(0, 100);
  const subjectTerm = asString(subject).trim().slice(0, 100);

  if (term) {
    const pattern = new RegExp(escapeRegExp(term), "i");
    filter.$or = [
      { title: pattern },
      { tutorName: pattern },
      { tutorEmail: pattern },
    ];
  }

  if (subjectTerm && subjectTerm.toLowerCase() !== "all") {
    filter.subject = new RegExp(`^${escapeRegExp(subjectTerm)}$`, "i");
  }

  if (status !== "all" && ADMIN_TUITION_STATUSES.has(status)) {
    filter.approvalStatus = new RegExp(
      `^${ADMIN_TUITION_STATUS_VALUES[status]}$`,
      "i",
    );
  }

  return filter;
}

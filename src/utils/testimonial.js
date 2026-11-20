import { toIsoString } from "./helpers.js";

export const TESTIMONIAL_MIN_LENGTH = 10;
export const TESTIMONIAL_MAX_LENGTH = 600;
export const TESTIMONIALS_PUBLIC_LIMIT = 12;
export const TESTIMONIAL_STATUSES = new Set(["pending", "approved", "rejected"]);

export function normalizeTestimonialStatus(value) {
  const status = String(value || "")
    .trim()
    .toLowerCase();
  return TESTIMONIAL_STATUSES.has(status) ? status : null;
}

export function normalizeTestimonialRole(value) {
  const role = String(value || "")
    .trim()
    .toLowerCase();
  return role === "student" || role === "tutor" ? role : "student";
}

export function serializeTestimonial(doc, verifiedIds) {
  return {
    id: String(doc._id),
    name: String(doc.name || "MentorLagbe member"),
    role: normalizeTestimonialRole(doc.role),
    rating: Number(doc.rating) || 0,
    message: String(doc.message || ""),
    image: doc.image ? String(doc.image) : null,
    verified: verifiedIds.has(String(doc.userId || "")),
    createdAt: toIsoString(doc.createdAt),
  };
}

export function serializeAdminTestimonial(doc, verifiedIds) {
  return {
    ...serializeTestimonial(doc, verifiedIds),
    userId: String(doc.userId || ""),
    status: normalizeTestimonialStatus(doc.status) || "pending",
    updatedAt: toIsoString(doc.updatedAt, new Date(toIsoString(doc.createdAt))),
  };
}

import { ObjectId } from "mongodb";
import { testimonialsCollection } from "../config/database.js";
import { requireInternalIdentity } from "../middleware/internalAuth.js";
import {
  ensureTestimonialUserIndex,
  getVerifiedUserIds,
} from "../services/testimonialService.js";
import { parseInteger } from "../utils/helpers.js";
import {
  TESTIMONIAL_MAX_LENGTH,
  TESTIMONIAL_MIN_LENGTH,
  TESTIMONIALS_PUBLIC_LIMIT,
  normalizeTestimonialStatus,
  serializeAdminTestimonial,
  serializeTestimonial,
} from "../utils/testimonial.js";

export async function getTestimonials(req, res) {
  try {
    const limit = parseInteger(
      req.query.limit,
      TESTIMONIALS_PUBLIC_LIMIT,
      1,
      TESTIMONIALS_PUBLIC_LIMIT,
    );

    const docs = await testimonialsCollection
      .find({ status: /^approved$/i })
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit)
      .toArray();

    const verifiedIds = await getVerifiedUserIds(
      docs.map((doc) => String(doc.userId || "")),
    );

    res.json({
      testimonials: docs.map((doc) => serializeTestimonial(doc, verifiedIds)),
      total: docs.length,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
}

export async function createTestimonial(req, res) {
  try {
    const user = await requireInternalIdentity(req, res, "x-user-id", [
      "student",
      "tutor",
    ]);
    if (!user) return;

    const rating = req.body?.rating;
    const message =
      typeof req.body?.message === "string" ? req.body.message.trim() : "";

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({
        error: "Rating must be a whole number between 1 and 5.",
      });
    }

    if (
      message.length < TESTIMONIAL_MIN_LENGTH ||
      message.length > TESTIMONIAL_MAX_LENGTH
    ) {
      return res.status(400).json({
        error: `Feedback must be between ${TESTIMONIAL_MIN_LENGTH} and ${TESTIMONIAL_MAX_LENGTH} characters.`,
      });
    }

    try {
      await ensureTestimonialUserIndex();
    } catch (error) {
      // A legacy duplicate must not block the first submission forever.
      console.error("Could not create testimonial index:", error);
    }

    const existing = await testimonialsCollection.findOne({
      userId: user.id,
    });
    if (existing) {
      return res.status(409).json({
        error: "You have already submitted a testimonial.",
      });
    }

    const now = new Date().toISOString();
    const result = await testimonialsCollection.insertOne({
      userId: user.id,
      name: String(user.user.name || "MentorLagbe member"),
      role: user.role,
      rating,
      message,
      image: user.user.image || null,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });

    res
      .status(201)
      .json({ id: result.insertedId.toString(), status: "pending" });
  } catch (error) {
    if (error && typeof error === "object" && error.code === 11000) {
      return res.status(409).json({
        error: "You have already submitted a testimonial.",
      });
    }

    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
}

export async function listAdminTestimonials(req, res) {
  try {
    const admin = await requireInternalIdentity(req, res, "x-admin-id", [
      "admin",
    ]);
    if (!admin) return;

    const rawStatus = String(req.query.status || "all")
      .trim()
      .toLowerCase();
    const status = normalizeTestimonialStatus(rawStatus);
    if (rawStatus !== "all" && !status) {
      return res.status(400).json({ error: "Invalid status filter." });
    }

    const filter = status ? { status: new RegExp(`^${status}$`, "i") } : {};
    const limit = parseInteger(req.query.limit, 20, 1, 100);
    const skip = parseInteger(req.query.skip, 0, 0, 100000);

    const [docs, total] = await Promise.all([
      testimonialsCollection
        .find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .toArray(),
      testimonialsCollection.countDocuments(filter),
    ]);

    const verifiedIds = await getVerifiedUserIds(
      docs.map((doc) => String(doc.userId || "")),
    );

    res.json({
      testimonials: docs.map((doc) =>
        serializeAdminTestimonial(doc, verifiedIds),
      ),
      total,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
}

export async function updateAdminTestimonialStatus(req, res) {
  try {
    const admin = await requireInternalIdentity(req, res, "x-admin-id", [
      "admin",
    ]);
    if (!admin) return;

    const status = String(req.body?.status || "")
      .trim()
      .toLowerCase();
    if (status !== "approved" && status !== "rejected") {
      return res
        .status(400)
        .json({ error: "Status must be 'approved' or 'rejected'." });
    }

    if (!ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ error: "Testimonial not found" });
    }

    const result = await testimonialsCollection.findOneAndUpdate(
      { _id: new ObjectId(req.params.id) },
      { $set: { status, updatedAt: new Date().toISOString() } },
      { returnDocument: "after", includeResultMetadata: true },
    );

    if (!result.value) {
      return res.status(404).json({ error: "Testimonial not found" });
    }

    res.json({
      id: String(result.value._id),
      status: normalizeTestimonialStatus(result.value.status),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
}

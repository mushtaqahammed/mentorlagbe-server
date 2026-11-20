import express from "express";
import { MongoClient, ObjectId } from "mongodb";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

const client = new MongoClient(
  `mongodb://${process.env.DB_USER}:${process.env.DB_PASSWORD}@ac-jxjfbm0-shard-00-00.luq0gtl.mongodb.net:27017,ac-jxjfbm0-shard-00-01.luq0gtl.mongodb.net:27017,ac-jxjfbm0-shard-00-02.luq0gtl.mongodb.net:27017/?ssl=true&replicaSet=atlas-6e5ydt-shard-0&authSource=admin`,
);

export async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
    return client;
  } catch (err) {
    console.dir(err);
  }
}

const connectedClient = await connectToMongoDB();
const database = connectedClient.db("mentor_lagbe");
const usersCollection = database.collection("user");
const sessionsCollection = database.collection("session");
const tuitionsCollection = database.collection("tuition");
const applicationsCollection = database.collection("application");
const testimonialsCollection = database.collection("testimonial");
const paymentsCollection = database.collection("payments");
const subscriptionsCollection = database.collection("subscriptions");



app.use(cors());
app.use(express.json());

function toObjectId(id) {
  try {
    return new ObjectId(id);
  } catch {
    return id;
  }
}

function unauthorized(res) {
  return res.status(401).json({ error: "Unauthorized" });
}

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

async function getUserFromRequest(req) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return null;

  const token = header.slice(7).trim();
  if (!token) return null;

  const session = await sessionsCollection.findOne({ token });
  if (!session) return null;

  const expiresAt = new Date(session.expiresAt).getTime();
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;

  const userId = session.userId?.toString();
  if (!userId) return null;

  const user = await usersCollection.findOne({ _id: toObjectId(userId) });
  if (!user) return null;

  return {
    id: userId,
    name: user.name || "",
    email: user.email || "",
    phone: user.phone || "",
    role: String(user.role || "").toLowerCase(),
    plan: String(user.plan || "free").toLowerCase(),
  };
}

async function getTutorFromRequest(req) {
  const user = await getUserFromRequest(req);
  if (!user || user.role !== "tutor") return null;
  return user;
}

function serializeTuition(tuition) {
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
const activeTuitionFilter = {
  approvalStatus: /^approved$/i,
  $or: [{ status: "Active" }, { status: { $exists: false } }, { status: null }],
};

function normalizeApplicationStatus(value) {
  const status = String(value || "pending").toLowerCase();
  return ["accepted", "rejected"].includes(status) ? status : "pending";
}

function countApplicationStatuses(applications) {
  return {
    total: applications.length,
    pending: applications.filter(
      (application) => normalizeApplicationStatus(application.status) === "pending"
    ).length,
    accepted: applications.filter(
      (application) => normalizeApplicationStatus(application.status) === "accepted"
    ).length,
    rejected: applications.filter(
      (application) => normalizeApplicationStatus(application.status) === "rejected"
    ).length,
  };
}

function serializeApplicant(application, tuitionTitles) {
  const tuitionId = String(application.tuitionId || "");
  const fallbackDate = application._id?.getTimestamp
    ? application._id.getTimestamp()
    : new Date();

  return {
    id: application._id.toString(),
    studentName: application.studentName || "",
    studentEmail: application.studentEmail || "",
    phone: application.phone || "",
    tuitionId,
    tuitionTitle:
      tuitionTitles.get(tuitionId) || "Tuition no longer available",
    preferredSchedule: application.preferredSchedule || "",
    note: application.note || "",
    applicationDate: application.createdAt || fallbackDate,
    status: normalizeApplicationStatus(application.status),
  };
}

function serializeStudentApplication(application, tuition, tutor) {
  const fallbackDate = application._id?.getTimestamp
    ? application._id.getTimestamp()
    : new Date();

  return {
    id: application._id.toString(),
    tuitionId: String(application.tuitionId || ""),
    tuitionTitle: tuition?.title || "Tuition no longer available",
    tutorName: tuition?.tutorName || tutor?.name || "Tutor",
    tutorEmail: tuition?.tutorEmail || tutor?.email || "",
    monthlyFee: Number(tuition?.monthlyFee || 0),
    applicationDate: application.createdAt || fallbackDate,
    status: normalizeApplicationStatus(application.status),
  };
}

const editableFields = [
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

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.get("/users", async (req, res) => {
  const cursor = usersCollection.find({});
  const users = await cursor.toArray();
  res.send(users);
});

app.get("/tuitions", async (req, res) => {
  try {
    const tutor = await getTutorFromRequest(req);
    if (!tutor) return unauthorized(res);

    if (req.query.tutorId && String(req.query.tutorId) !== tutor.id) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const tuitions = await tuitionsCollection
      .find({ tutorId: tutor.id })
      .sort({ createdAt: -1, _id: -1 })
      .toArray();

    res.json(tuitions.map(serializeTuition));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
});


app.get("/tuitions/count", async (req, res) => {
  const query = req.query || {};
  if (req.query.tutorId) {
    query.tutorId = req.query.tutorId;
  }
  const count = await tuitionsCollection.countDocuments(query);
 res.send({ count });
});

app.post("/tuitions", async (req, res) => {
  try {
    const tutor = await getTutorFromRequest(req);
    if (!tutor) return unauthorized(res);

    const now = new Date();
    const result = await tuitionsCollection.insertOne({
      ...req.body,
      tutorId: tutor.id,
      tutorName: tutor.name,
      tutorEmail: tutor.email,
      approvalStatus: "Pending",
      status: "Active",
      createdAt: now,
      updatedAt: now,
    });

    res.status(201).json({ id: result.insertedId.toString() });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
});

app.put("/tuitions/:id", async (req, res) => {
  try {
    const tutor = await getTutorFromRequest(req);
    if (!tutor) return unauthorized(res);

    const tuitionId = toObjectId(req.params.id);
    const current = await tuitionsCollection.findOne({
      _id: tuitionId,
      tutorId: tutor.id,
    });

    if (!current) {
      return res.status(404).json({ error: "Tuition not found" });
    }

    const body = req.body || {};
    const update = {};
    for (const field of editableFields) {
      if (field in body) update[field] = body[field];
    }
    update.updatedAt = new Date();

    await tuitionsCollection.updateOne({ _id: tuitionId }, { $set: update });
    const updated = await tuitionsCollection.findOne({ _id: tuitionId });

    res.json(serializeTuition(updated));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
});

app.patch("/tuitions/:id/status", async (req, res) => {
  try {
    const tutor = await getTutorFromRequest(req);
    if (!tutor) return unauthorized(res);

    const status = req.body?.status;
    if (status !== "Active" && status !== "Closed") {
      return res.status(400).json({ error: "Invalid status" });
    }

    const result = await tuitionsCollection.findOneAndUpdate(
      {
        _id: toObjectId(req.params.id),
        tutorId: tutor.id,
      },
      { $set: { status, updatedAt: new Date() } },
      { returnDocument: "after", includeResultMetadata: true },
    );

    if (!result.value) {
      return res.status(404).json({ error: "Tuition not found" });
    }

    res.json(serializeTuition(result.value));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
});

app.delete("/tuitions/:id", async (req, res) => {
  try {
    const tutor = await getTutorFromRequest(req);
    if (!tutor) return unauthorized(res);

    const result = await tuitionsCollection.deleteOne({
      _id: toObjectId(req.params.id),
      tutorId: tutor.id,
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: "Tuition not found" });
    }

    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/all-tuitions", async (req, res) => {
  try {
    const tuitions = await tuitionsCollection
      .find(activeTuitionFilter)
      .sort({ createdAt: -1, _id: -1 })
      .toArray();

    const tutorIds = [
      ...new Set(
        tuitions
          .map((tuition) => String(tuition.tutorId || ""))
          .filter(Boolean)
      ),
    ];
    const tutors = await usersCollection
      .find({ _id: { $in: tutorIds.map(toObjectId) } })
      .toArray();
    const tutorNames = new Map(
      tutors.map((tutor) => [tutor._id.toString(), tutor.name || "Tutor"])
    );

    res.json(
      tuitions.map((tuition) => ({
        ...serializeTuition(tuition),
        tutorName:
          tutorNames.get(String(tuition.tutorId || "")) || "Tutor",
      }))
    );
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/all-tuitions/:id", async (req, res) => {
  try {
    const tuition = await tuitionsCollection.findOne({
      _id: toObjectId(req.params.id),
      ...activeTuitionFilter,
    });

    if (!tuition) {
      return res.status(404).json({ error: "Tuition not found" });
    }

    const tutor = await usersCollection.findOne({
      _id: toObjectId(String(tuition.tutorId || "")),
    });

    res.json({
      ...serializeTuition(tuition),
      tutorName: tutor?.name || "Tutor",
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/tuitions/:id/apply", async (req, res) => {
  try {
    const student = await getUserFromRequest(req);
    if (!student) return unauthorized(res);

    if (student.role !== "student") {
      return res
        .status(403)
        .json({ error: "Only students can apply for tuitions." });
    }

    const tuitionId = toObjectId(req.params.id);
    const tuition = await tuitionsCollection.findOne({
      _id: tuitionId,
      ...activeTuitionFilter,
    });

    if (!tuition) {
      return res.status(404).json({ error: "Tuition not found" });
    }

    const existing = await applicationsCollection.findOne({
      tuitionId: tuitionId.toString(),
      studentId: student.id,
    });

    if (existing) {
      return res
        .status(409)
        .json({ error: "You have already applied for this tuition." });
    }

    const now = new Date();
    const phone =
      cleanText(req.body?.phone, 40) || cleanText(student.phone, 40);
    const preferredSchedule = cleanText(req.body?.preferredSchedule, 120);
    const note = cleanText(req.body?.note, 1000);

    const result = await applicationsCollection.insertOne({
      tuitionId: tuitionId.toString(),
      studentId: student.id,
      studentName: student.name,
      studentEmail: student.email,
      phone,
      preferredSchedule,
      note,
      tutorId: String(tuition.tutorId || ""),
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });

    res.status(201).json({ id: result.insertedId.toString(), status: "pending" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/tutor-applicants", async (req, res) => {
  try {
    const tutor = await getTutorFromRequest(req);
    if (!tutor) return unauthorized(res);

    const tutorTuitions = await tuitionsCollection
      .find({ tutorId: tutor.id }, { projection: { _id: 1, title: 1 } })
      .toArray();

    const tuitionTitles = new Map(
      tutorTuitions.map((tuition) => [
        tuition._id.toString(),
        tuition.title || "",
      ])
    );
    const tuitionIds = [...tuitionTitles.keys()];

    const applications = tuitionIds.length
      ? await applicationsCollection
          .find({ tuitionId: { $in: tuitionIds } })
          .sort({ createdAt: -1 })
          .toArray()
      : [];

    const applicants = applications.map((application) =>
      serializeApplicant(application, tuitionTitles)
    );

    res.json({
      applicants,
      stats: {
        total: applicants.length,
        pending: applicants.filter(
          (applicant) => applicant.status === "pending"
        ).length,
        accepted: applicants.filter(
          (applicant) => applicant.status === "accepted"
        ).length,
        rejected: applicants.filter(
          (applicant) => applicant.status === "rejected"
        ).length,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
});

app.patch("/applications/:id/status", async (req, res) => {
  try {
    const tutor = await getTutorFromRequest(req);
    if (!tutor) return unauthorized(res);

    const status = String(req.body?.status || "").toLowerCase();
    if (!["accepted", "rejected"].includes(status)) {
      return res.status(400).json({ error: "Invalid application status." });
    }

    const application = await applicationsCollection.findOne({
      _id: toObjectId(req.params.id),
    });

    if (!application) {
      return res.status(404).json({ error: "Application not found" });
    }

    if (normalizeApplicationStatus(application.status) !== "pending") {
      return res
        .status(409)
        .json({ error: "Only pending applications can be reviewed." });
    }

    const tuition = await tuitionsCollection.findOne({
      _id: toObjectId(application.tuitionId),
      tutorId: tutor.id,
    });

    if (!tuition || String(application.tutorId || "") !== tutor.id) {
      return res.status(404).json({ error: "Application not found" });
    }

    const result = await applicationsCollection.updateOne(
      {
        _id: application._id,
        tutorId: tutor.id,
        tuitionId: application.tuitionId,
        status: { $in: ["Pending", "pending"] },
      },
      {
        $set: {
          status,
          updatedAt: new Date(),
          reviewedBy: tutor.id,
        },
      }
    );

    if (result.matchedCount === 0) {
      return res
        .status(409)
        .json({ error: "Only pending applications can be reviewed." });
    }

    res.json({ id: application._id.toString(), status });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/tutor-stats", async (req, res) => {
  try {
    const tutor = await getTutorFromRequest(req);
    if (!tutor) return unauthorized(res);

    const [totalTuitions, activeApprovedTuitions, tutorTuitions] =
      await Promise.all([
        tuitionsCollection.countDocuments({ tutorId: tutor.id }),
        tuitionsCollection.countDocuments({
          tutorId: tutor.id,
          status: "Active",
          approvalStatus: "Approved",
        }),
        tuitionsCollection
          .find({ tutorId: tutor.id }, { projection: { _id: 1 } })
          .toArray(),
      ]);

    const tuitionIds = tutorTuitions.map((tuition) => tuition._id.toString());
    const totalApplicants = tuitionIds.length
      ? await applicationsCollection.countDocuments({
          tuitionId: { $in: tuitionIds },
        })
      : 0;

    res.json({
      totalTuitions,
      activeApprovedTuitions,
      totalApplicants,
      plan: tutor.plan || "free",
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/student-stats", async (req, res) => {
  try {
    const student = await getUserFromRequest(req);
    if (!student) return unauthorized(res);

    if (student.role !== "student") {
      return res
        .status(403)
        .json({ error: "Only students can view student statistics." });
    }

    const applications = await applicationsCollection
      .find({ studentId: student.id }, { projection: { status: 1 } })
      .toArray();

    const counts = countApplicationStatuses(applications);

    res.json({
      totalApplied: counts.total,
      accepted: counts.accepted,
      pending: counts.pending,
      plan: student.plan || "free",
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/student-applications", async (req, res) => {
  try {
    const student = await getUserFromRequest(req);
    if (!student) return unauthorized(res);

    if (student.role !== "student") {
      return res
        .status(403)
        .json({ error: "Only students can view student applications." });
    }

    const applications = await applicationsCollection
      .find({ studentId: student.id })
      .sort({ createdAt: -1, _id: -1 })
      .toArray();

    const tuitionIds = [
      ...new Set(
        applications
          .map((application) => String(application.tuitionId || ""))
          .filter(Boolean)
      ),
    ];
    const tutorIds = [
      ...new Set(
        applications
          .map((application) => String(application.tutorId || ""))
          .filter(Boolean)
      ),
    ];

    const [tuitions, tutors] = await Promise.all([
      tuitionIds.length
        ? tuitionsCollection
            .find(
              { _id: { $in: tuitionIds.map(toObjectId) } },
              {
                projection: {
                  title: 1,
                  monthlyFee: 1,
                  tutorId: 1,
                  tutorName: 1,
                  tutorEmail: 1,
                },
              }
            )
            .toArray()
        : [],
      tutorIds.length
        ? usersCollection
            .find(
              { _id: { $in: tutorIds.map(toObjectId) } },
              { projection: { name: 1, email: 1 } }
            )
            .toArray()
        : [],
    ]);

    const tuitionMap = new Map(
      tuitions.map((tuition) => [tuition._id.toString(), tuition])
    );
    const tutorMap = new Map(
      tutors.map((tutor) => [tutor._id.toString(), tutor])
    );

    res.json({
      applications: applications.map((application) => {
        const tuition = tuitionMap.get(String(application.tuitionId || ""));
        const tutor =
          tutorMap.get(String(tuition?.tutorId || "")) ||
          tutorMap.get(String(application.tutorId || ""));

        return serializeStudentApplication(application, tuition, tutor);
      }),
      stats: countApplicationStatuses(applications),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
});

app.delete("/applications/:id", async (req, res) => {
  try {
    const student = await getUserFromRequest(req);
    if (!student) return unauthorized(res);

    if (student.role !== "student") {
      return res
        .status(403)
        .json({ error: "Only students can cancel their applications." });
    }

    const application = await applicationsCollection.findOne({
      _id: toObjectId(req.params.id),
    });

    if (!application || String(application.studentId || "") !== student.id) {
      return res.status(404).json({ error: "Application not found" });
    }

    if (normalizeApplicationStatus(application.status) !== "pending") {
      return res
        .status(409)
        .json({ error: "Only pending applications can be cancelled." });
    }

    const result = await applicationsCollection.deleteOne({
      _id: application._id,
      studentId: student.id,
      status: { $in: ["Pending", "pending"] },
    });

    if (result.deletedCount === 0) {
      return res
        .status(409)
        .json({ error: "Only pending applications can be cancelled." });
    }

    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
});

// ---------------------------------------------------------------------------
// Platform statistics + testimonials
// ---------------------------------------------------------------------------
// Public reads live here so the Next.js app never needs direct MongoDB access.
// Internal mutations require the shared secret AND a real user/admin record in
// MongoDB; the role sent by the client is deliberately ignored.
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || "";
const TESTIMONIAL_MIN_LENGTH = 10;
const TESTIMONIAL_MAX_LENGTH = 600;
const TESTIMONIALS_PUBLIC_LIMIT = 12;
const TESTIMONIAL_STATUSES = new Set(["pending", "approved", "rejected"]);

function hasInternalSecret(req) {
  return (
    Boolean(INTERNAL_API_SECRET) &&
    String(req.headers["x-internal-secret"] || "") === INTERNAL_API_SECRET
  );
}

async function findUserById(id) {
  const value = String(id || "").trim();
  if (!value || !ObjectId.isValid(value)) return null;
  return usersCollection.findOne({ _id: new ObjectId(value) });
}

async function requireInternalIdentity(req, res, headerName, allowedRoles) {
  if (!hasInternalSecret(req)) {
    unauthorized(res);
    return null;
  }

  const userId = String(req.headers[headerName] || "").trim();
  if (!userId) {
    unauthorized(res);
    return null;
  }

  const user = await findUserById(userId);
  if (!user) {
    unauthorized(res);
    return null;
  }

  const role = String(user.role || "")
    .trim()
    .toLowerCase();

  if (allowedRoles && !allowedRoles.includes(role)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  return { id: String(user._id), role, user };
}

function normalizeTestimonialStatus(value) {
  const status = String(value || "")
    .trim()
    .toLowerCase();
  return TESTIMONIAL_STATUSES.has(status) ? status : null;
}

function normalizeTestimonialRole(value) {
  const role = String(value || "")
    .trim()
    .toLowerCase();
  return role === "student" || role === "tutor" ? role : "student";
}

function toIsoString(value, fallback = new Date()) {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime())
    ? parsed.toISOString()
    : fallback.toISOString();
}

async function getVerifiedUserIds(userIds) {
  const ids = Array.from(
    new Set(
      userIds.map((id) => String(id || "").trim()).filter((id) => id.length > 0)
    )
  );

  if (ids.length === 0) return new Set();

  const objectIds = ids.filter((id) => ObjectId.isValid(id)).map(toObjectId);

  const users = await usersCollection
    .find(
      {
        emailVerified: true,
        $or: [{ _id: { $in: objectIds } }, { _id: { $in: ids } }],
      },
      { projection: { _id: 1 } }
    )
    .toArray();

  return new Set(users.map((user) => String(user._id)));
}

function serializeTestimonial(doc, verifiedIds) {
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

function serializeAdminTestimonial(doc, verifiedIds) {
  return {
    ...serializeTestimonial(doc, verifiedIds),
    userId: String(doc.userId || ""),
    status: normalizeTestimonialStatus(doc.status) || "pending",
    updatedAt: toIsoString(doc.updatedAt, new Date(toIsoString(doc.createdAt))),
  };
}

function parseInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

async function countActiveStudents() {
  const activeSessions = await sessionsCollection
    .find(
      { expiresAt: { $gt: new Date() } },
      { projection: { userId: 1, _id: 0 } }
    )
    .toArray();

  const userIds = Array.from(
    new Set(
      activeSessions
        .map((session) => String(session.userId ?? ""))
        .filter((id) => id.length > 0)
    )
  );

  if (userIds.length === 0) return 0;

  const objectIds = userIds
    .filter((id) => ObjectId.isValid(id))
    .map((id) => new ObjectId(id));

  return usersCollection.countDocuments({
    role: /^student$/i,
    $or: [{ _id: { $in: objectIds } }, { _id: { $in: userIds } }],
  });
}

let testimonialsIndexPromise = null;

function ensureTestimonialUserIndex() {
  if (!testimonialsIndexPromise) {
    testimonialsIndexPromise = testimonialsCollection
      .createIndex(
        { userId: 1 },
        { unique: true, name: "one_testimonial_per_user" }
      )
      .catch((error) => {
        testimonialsIndexPromise = null;
        throw error;
      });
  }

  return testimonialsIndexPromise;
}

app.get("/platform/stats", async (req, res) => {
  try {
    const [verifiedTutors, activeStudents, approvedTuitions, successfulMatches] =
      await Promise.all([
        usersCollection.countDocuments({
          role: /^tutor$/i,
          emailVerified: true,
        }),
        countActiveStudents(),
        tuitionsCollection.countDocuments(activeTuitionFilter),
        applicationsCollection.countDocuments({ status: /^accepted$/i }),
      ]);

    res.json({
      verifiedTutors,
      activeStudents,
      approvedTuitions,
      successfulMatches,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/testimonials", async (req, res) => {
  try {
    const limit = parseInteger(
      req.query.limit,
      TESTIMONIALS_PUBLIC_LIMIT,
      1,
      TESTIMONIALS_PUBLIC_LIMIT
    );

    const docs = await testimonialsCollection
      .find({ status: /^approved$/i })
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit)
      .toArray();

    const verifiedIds = await getVerifiedUserIds(
      docs.map((doc) => String(doc.userId || ""))
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
});

app.post("/testimonials", async (req, res) => {
  try {
    const user = await requireInternalIdentity(
      req,
      res,
      "x-user-id",
      ["student", "tutor"]
    );
    if (!user) return;

    const rating = req.body?.rating;
    const message =
      typeof req.body?.message === "string" ? req.body.message.trim() : "";

    if (
      !Number.isInteger(rating) ||
      rating < 1 ||
      rating > 5
    ) {
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

    res.status(201).json({ id: result.insertedId.toString(), status: "pending" });
  } catch (error) {
    if (error && typeof error === "object" && error.code === 11000) {
      return res.status(409).json({
        error: "You have already submitted a testimonial.",
      });
    }

    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/admin/testimonials", async (req, res) => {
  try {
    const admin = await requireInternalIdentity(
      req,
      res,
      "x-admin-id",
      ["admin"]
    );
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
      docs.map((doc) => String(doc.userId || ""))
    );

    res.json({
      testimonials: docs.map((doc) =>
        serializeAdminTestimonial(doc, verifiedIds)
      ),
      total,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
});

app.patch("/admin/testimonials/:id", async (req, res) => {
  try {
    const admin = await requireInternalIdentity(
      req,
      res,
      "x-admin-id",
      ["admin"]
    );
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
      { returnDocument: "after", includeResultMetadata: true }
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
});

// ---------------------------------------------------------------------------
// Application data APIs
// ---------------------------------------------------------------------------
// These endpoints are the only place application collections are read or
// written. Next.js calls them with the internal secret and a verified
// user/admin id; Better Auth keeps using its own adapter for auth data.
const ADMIN_USER_ROLE_VALUES = {
  student: "Student",
  tutor: "Tutor",
  admin: "Admin",
};
const ADMIN_USER_ROLES = new Set(Object.keys(ADMIN_USER_ROLE_VALUES));
const ADMIN_TUITION_STATUS_VALUES = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
};
const ADMIN_TUITION_STATUSES = new Set(
  Object.keys(ADMIN_TUITION_STATUS_VALUES)
);
const ADMIN_TRANSACTION_ROLES = new Set(["tutor", "student"]);
const ADMIN_TRANSACTION_PLANS = new Set(["pro-tutor", "pro-student"]);
const PRO_PLANS = {
  "pro-tutor": { id: "pro-tutor", name: "Pro Tutor", price: 15 },
  "pro-student": { id: "pro-student", name: "Pro Student", price: 10 },
};
const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["active", "trialing"]);
const PAYMENT_SUCCESS_STATUSES = /^(succeeded|success|paid|completed|complete)$/i;
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

function requireInternalService(req, res) {
  if (!hasInternalSecret(req)) {
    unauthorized(res);
    return false;
  }
  return true;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function asString(value, fallback = "") {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return fallback;
}

function toIsoStringOrNull(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
}

function toDateOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toUserObjectId(value) {
  const id = String(value || "");
  return ObjectId.isValid(id) ? new ObjectId(id) : id;
}

function normalizeAdminUserRole(value) {
  const role = asString(value)
    .trim()
    .toLowerCase();
  return ADMIN_USER_ROLES.has(role) ? role : "student";
}

function normalizeApprovalStatus(value) {
  const status = asString(value)
    .trim()
    .toLowerCase();
  return ADMIN_TUITION_STATUSES.has(status) ? status : "pending";
}

function normalizeLifecycleStatus(value) {
  return asString(value).trim().toLowerCase() === "closed" ? "closed" : "active";
}

function getPlanById(id) {
  return PRO_PLANS[asString(id)] || null;
}

function getPlanForRole(role) {
  const normalized = asString(role)
    .trim()
    .toLowerCase();
  if (normalized === "tutor") return PRO_PLANS["pro-tutor"];
  if (normalized === "student") return PRO_PLANS["pro-student"];
  return null;
}

function formatMoney(amount, currency, locale, fallbackCurrency) {
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: fallbackCurrency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(amount);
  }
}

async function getPaymentsCollectionForStats() {
  const existing = await database.listCollections({}, { nameOnly: true }).toArray();
  const name = ["payments", "payment"].find((candidate) =>
    existing.some((collection) => collection.name === candidate)
  );
  return name ? database.collection(name) : paymentsCollection;
}

let paymentsSetupPromise = null;

function ensurePaymentsCollection() {
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
        }
      );
    })().catch((error) => {
      paymentsSetupPromise = null;
      console.error("Could not prepare the payments collection:", error);
    });
  }

  return paymentsSetupPromise;
}

function serializeSubscriptionState(record) {
  const status = asString(record?.status, "none");
  const isPro =
    record?.isPro === true && ACTIVE_SUBSCRIPTION_STATUSES.has(status.toLowerCase());
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

async function getSubscriptionStateFromDb(userId) {
  const record = await subscriptionsCollection.findOne(
    { userId: String(userId) },
    { sort: { updatedAt: -1 } }
  );
  return serializeSubscriptionState(record);
}

async function recordSubscriptionPayment(payload) {
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
      { upsert: true }
    );
  } catch (error) {
    // A concurrent confirm/webhook request may have inserted this already.
    if (error?.code !== 11000) {
      console.error("Could not record the Stripe payment:", error);
    }
  }
}

async function applySubscriptionState(payload) {
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
        { upsert: true }
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
      { upsert: true }
    ),
    usersCollection.updateOne({ _id: user._id }, [{ $set: userSet }]),
  ]);

  return getSubscriptionStateFromDb(userId);
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
    ...new Set(tutorIds.filter((id) => Boolean(id) && ObjectId.isValid(String(id)))),
  ];
  if (validIds.length === 0) return new Map();

  const tutors = await usersCollection
    .find(
      { _id: { $in: validIds.map((id) => new ObjectId(String(id))) } },
      { projection: { name: 1, email: 1 } }
    )
    .toArray();

  return new Map(
    tutors.map((tutor) => [
      String(tutor._id),
      {
        name: asString(tutor.name).trim() || "Tutor",
        email: asString(tutor.email),
      },
    ])
  );
}

function serializeAdminTuition(tuition, tutors) {
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

function serializeFeaturedTuition(tuition, tutorNames) {
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

function verifiedPaymentConditions() {
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

function combine(conditions) {
  return { $and: conditions };
}

function buildRoleConditions(role) {
  if (role === "all" || !ADMIN_TRANSACTION_ROLES.has(role)) return [];
  return [{ userRole: new RegExp(`^${escapeRegExp(role)}$`, "i") }];
}

function buildPlanConditions(plan) {
  if (plan === "all" || !ADMIN_TRANSACTION_PLANS.has(plan)) return [];

  const config = getPlanById(plan);
  const matches = [
    { planId: new RegExp(`^${escapeRegExp(plan)}$`, "i") },
  ];
  if (config) {
    matches.push({ planName: new RegExp(`^${escapeRegExp(config.name)}$`, "i") });
  }
  return [{ $or: matches }];
}

async function buildSearchConditions(search) {
  const term = asString(search).trim().slice(0, 100);
  if (!term) return [];

  const pattern = new RegExp(escapeRegExp(term), "i");
  const users = await usersCollection
    .find(
      { $or: [{ name: pattern }, { email: pattern }] },
      { projection: { _id: 1 } }
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

async function getTransactionUsers(userIds) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0) return new Map();

  const users = await usersCollection
    .find(
      { _id: { $in: ids.map(toUserObjectId) } },
      { projection: { name: 1, email: 1, role: 1, proPlanId: 1 } }
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
    ])
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

function serializeTransaction(payment, users) {
  const userId = asString(payment.userId);
  const user = users.get(userId);
  const storedRole =
    normalizeTransactionRole(payment.userRole) || normalizeTransactionRole(user?.role);
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

async function getTransactionSummary() {
  const verified = combine(verifiedPaymentConditions());

  const [total, tutorCount, studentCount, revenueResult] = await Promise.all([
    paymentsCollection.countDocuments(verified),
    paymentsCollection.countDocuments(
      combine([...verifiedPaymentConditions(), ...buildRoleConditions("tutor")])
    ),
    paymentsCollection.countDocuments(
      combine([...verifiedPaymentConditions(), ...buildRoleConditions("student")])
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

async function getStatsRevenue() {
  const payments = await getPaymentsCollectionForStats();
  const empty = {
    amount: 0,
    currency: "BDT",
    formatted: formatMoney(0, "BDT", "en-BD", "BDT"),
  };
  const [summary] = await payments.aggregate(buildStatsRevenuePipeline()).toArray();
  const amount = Number.isFinite(summary?.total) ? summary.total : 0;
  const currency =
    summary?.currencies.find((code) => /^[A-Z]{3}$/.test(code)) || "BDT";

  return {
    amount,
    currency,
    formatted: formatMoney(amount, currency, "en-BD", "BDT"),
  };
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

app.get("/featured-tuitions", async (req, res) => {
  try {
    const docs = await tuitionsCollection
      .find(activeTuitionFilter)
      .sort({ createdAt: -1, _id: -1 })
      .limit(6)
      .toArray();

    const tutorNames = new Map(
      (
        await usersCollection
          .find(
            {
              _id: {
                $in: docs
                  .map((tuition) => asString(tuition.tutorId))
                  .filter((id) => id && ObjectId.isValid(id))
                  .map((id) => new ObjectId(id)),
              },
            },
            { projection: { name: 1 } }
          )
          .toArray()
      ).map((tutor) => [
        String(tutor._id),
        asString(tutor.name).trim() || "Tutor",
      ])
    );

    res.json({
      tuitions: docs.map((tuition) =>
        serializeFeaturedTuition(tuition, tutorNames)
      ),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/admin/users", async (req, res) => {
  try {
    const admin = await requireInternalIdentity(req, res, "x-admin-id", [
      "admin",
    ]);
    if (!admin) return;

    const filter = buildUserFilter(
      asString(req.query.search),
      asString(req.query.role, "all")
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
});

app.patch("/admin/users/:id/role", async (req, res) => {
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
      { returnDocument: "after", includeResultMetadata: true }
    );

    if (!result.value) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({ user: serializeAdminUser(result.value) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
});

function buildAdminTuitionFilter(search, subject, status) {
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
      "i"
    );
  }

  return filter;
}

app.get("/admin/tuitions", async (req, res) => {
  try {
    const admin = await requireInternalIdentity(req, res, "x-admin-id", [
      "admin",
    ]);
    if (!admin) return;

    const search = asString(req.query.search);
    const subject = asString(req.query.subject);
    const status = asString(req.query.status, "all");
    const baseFilter = buildAdminTuitionFilter(search, subject, "all");
    const filter = buildAdminTuitionFilter(search, subject, status);
    const limit = parseInteger(req.query.limit, 6, 1, 50);
    const requestedPage = parseInteger(req.query.page, 1, 1, 100000);

    const statusValues = ["all", ...ADMIN_TUITION_STATUSES];
    const [countsResult, total, totalTuitions] = await Promise.all([
      Promise.all(
        statusValues.map(async (value) => ({
          value,
          count: await tuitionsCollection.countDocuments(
            buildAdminTuitionFilter(search, subject, value)
          ),
        }))
      ),
      tuitionsCollection.countDocuments(filter),
      tuitionsCollection.countDocuments({}),
    ]);

    const counts = Object.fromEntries(
      countsResult.map(({ value, count }) => [value, count])
    );
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const page = Math.min(requestedPage, totalPages);
    const direction = asString(req.query.sort).toLowerCase() === "oldest" ? 1 : -1;

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
      docs.map((tuition) => asString(tuition.tutorId))
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
});

app.patch("/admin/tuitions/:id/approval", async (req, res) => {
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
      { returnDocument: "after", includeResultMetadata: true }
    );

    if (!result.value) {
      return res.status(404).json({ error: "Tuition not found" });
    }

    const tutors = await getTutorIdentities([
      asString(result.value.tutorId),
    ]);

    res.json({ tuition: serializeAdminTuition(result.value, tutors) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/admin/stats", async (req, res) => {
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
});

app.get("/admin/transactions", async (req, res) => {
  try {
    const admin = await requireInternalIdentity(req, res, "x-admin-id", [
      "admin",
    ]);
    if (!admin) return;

    await ensurePaymentsCollection();

    const searchConditions = await buildSearchConditions(asString(req.query.search));
    const planConditions = buildPlanConditions(asString(req.query.plan, "all"));
    const roleFilter = asString(req.query.role, "all");
    const baseConditions = [
      ...verifiedPaymentConditions(),
      ...searchConditions,
      ...planConditions,
    ];
    const filter = combine([...baseConditions, ...buildRoleConditions(roleFilter)]);
    const limit = parseInteger(req.query.limit, 8, 1, 50);
    const requestedPage = parseInteger(req.query.page, 1, 1, 100000);

    const roleValues = ["all", ...ADMIN_TRANSACTION_ROLES];
    const [total, ...roleCounts] = await Promise.all([
      paymentsCollection.countDocuments(filter),
      ...roleValues.map((value) =>
        paymentsCollection.countDocuments(
          combine([...baseConditions, ...buildRoleConditions(value)])
        )
      ),
    ]);

    const counts = Object.fromEntries(
      roleValues.map((value, index) => [value, roleCounts[index] || 0])
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
      docs.map((payment) => asString(payment.userId))
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
});

app.get("/internal/users/:id", async (req, res) => {
  try {
    if (!requireInternalService(req, res)) return;

    const user = await findUserById(req.params.id);
    if (!user) return res.json(null);

    res.json({
      id: String(user._id),
      role: asString(user.role),
      name: asString(user.name),
      email: asString(user.email),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/internal/subscription-by-session", async (req, res) => {
  try {
    if (!requireInternalService(req, res)) return;

    const stripeSessionId = asString(req.query.stripeSessionId).trim();
    if (!stripeSessionId) return res.json(null);

    const record = await subscriptionsCollection.findOne(
      { stripeSessionId },
      { sort: { updatedAt: -1 } }
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
});

app.get("/internal/subscription-state", async (req, res) => {
  try {
    const user = await requireInternalIdentity(req, res, "x-user-id", null);
    if (!user) return;

    res.json(await getSubscriptionStateFromDb(user.id));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/internal/payments", async (req, res) => {
  try {
    if (!requireInternalService(req, res)) return;

    const payload = req.body || {};
    const user = await findUserById(payload.userId);
    if (!user) {
      return res.status(404).json({ error: "Account not found" });
    }

    await recordSubscriptionPayment(payload);
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/internal/subscriptions/apply", async (req, res) => {
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
});

await ensurePaymentsCollection();

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});

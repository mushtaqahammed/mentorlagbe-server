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

// Public pages only show active posts. Older posts without a status are
// treated as active, matching the fallback used in serializeTuition().
const activeTuitionFilter = {
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

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});

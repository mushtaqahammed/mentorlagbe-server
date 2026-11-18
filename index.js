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

async function getTutorFromRequest(req) {
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
  if (!user || String(user.role).toLowerCase() !== "tutor") return null;

  return {
    id: userId,
    name: user.name || "",
    email: user.email || "",
  };
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
      .find({})
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

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});

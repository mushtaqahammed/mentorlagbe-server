import { ObjectId } from "mongodb";
import { tuitionsCollection, usersCollection } from "../config/database.js";
import { getTutorFromRequest, unauthorized } from "../middleware/auth.js";
import { asString, toObjectId } from "../utils/helpers.js";
import {
  activeTuitionFilter,
  editableFields,
  serializeFeaturedTuition,
  serializeTuition,
} from "../utils/tuition.js";

export async function listTutorTuitions(req, res) {
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
}

export async function countTuitions(req, res) {
  const query = req.query || {};
  if (req.query.tutorId) {
    query.tutorId = req.query.tutorId;
  }
  const count = await tuitionsCollection.countDocuments(query);
  res.send({ count });
}

export async function createTuition(req, res) {
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
}

export async function updateTuition(req, res) {
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
}

export async function updateTuitionStatus(req, res) {
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
}

export async function deleteTuition(req, res) {
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
}

export async function listAllTuitions(req, res) {
  try {
    const tuitions = await tuitionsCollection
      .find(activeTuitionFilter)
      .sort({ createdAt: -1, _id: -1 })
      .toArray();

    const tutorIds = [
      ...new Set(
        tuitions
          .map((tuition) => String(tuition.tutorId || ""))
          .filter(Boolean),
      ),
    ];
    const tutors = await usersCollection
      .find({ _id: { $in: tutorIds.map(toObjectId) } })
      .toArray();
    const tutorNames = new Map(
      tutors.map((tutor) => [tutor._id.toString(), tutor.name || "Tutor"]),
    );

    res.json(
      tuitions.map((tuition) => ({
        ...serializeTuition(tuition),
        tutorName: tutorNames.get(String(tuition.tutorId || "")) || "Tutor",
      })),
    );
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
}

export async function getTuitionById(req, res) {
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
}

export async function listFeaturedTuitions(req, res) {
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
            { projection: { name: 1 } },
          )
          .toArray()
      ).map((tutor) => [
        String(tutor._id),
        asString(tutor.name).trim() || "Tutor",
      ]),
    );

    res.json({
      tuitions: docs.map((tuition) =>
        serializeFeaturedTuition(tuition, tutorNames),
      ),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
}

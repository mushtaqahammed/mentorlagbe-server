import { ObjectId } from "mongodb";
import {
  sessionsCollection,
  testimonialsCollection,
  usersCollection,
} from "../config/database.js";
import { toObjectId } from "../utils/helpers.js";

export async function getVerifiedUserIds(userIds) {
  const ids = Array.from(
    new Set(
      userIds.map((id) => String(id || "").trim()).filter((id) => id.length > 0),
    ),
  );

  if (ids.length === 0) return new Set();

  const objectIds = ids.filter((id) => ObjectId.isValid(id)).map(toObjectId);

  const users = await usersCollection
    .find(
      {
        emailVerified: true,
        $or: [{ _id: { $in: objectIds } }, { _id: { $in: ids } }],
      },
      { projection: { _id: 1 } },
    )
    .toArray();

  return new Set(users.map((user) => String(user._id)));
}

let testimonialsIndexPromise = null;

export function ensureTestimonialUserIndex() {
  if (!testimonialsIndexPromise) {
    testimonialsIndexPromise = testimonialsCollection
      .createIndex(
        { userId: 1 },
        { unique: true, name: "one_testimonial_per_user" },
      )
      .catch((error) => {
        testimonialsIndexPromise = null;
        throw error;
      });
  }

  return testimonialsIndexPromise;
}

export async function countActiveStudents() {
  const activeSessions = await sessionsCollection
    .find(
      { expiresAt: { $gt: new Date() } },
      { projection: { userId: 1, _id: 0 } },
    )
    .toArray();

  const userIds = Array.from(
    new Set(
      activeSessions
        .map((session) => String(session.userId ?? ""))
        .filter((id) => id.length > 0),
    ),
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

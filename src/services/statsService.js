import { ObjectId } from "mongodb";

import { sessionsCollection, usersCollection } from "../config/database.js";

/**
 * Active students are users with a currently unexpired Better Auth session.
 * Shared by the public platform-stats endpoint.
 */
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

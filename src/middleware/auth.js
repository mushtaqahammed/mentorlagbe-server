import { sessionsCollection, usersCollection } from "../config/database.js";
import { toObjectId } from "../utils/helpers.js";

export function unauthorized(res) {
  return res.status(401).json({ error: "Unauthorized" });
}

export async function getUserFromRequest(req) {
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

export async function getTutorFromRequest(req) {
  const user = await getUserFromRequest(req);
  if (!user || user.role !== "tutor") return null;
  return user;
}

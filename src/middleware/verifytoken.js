import {
  sessionsCollection,
  usersCollection,
} from "../config/database.js";
import { toObjectId } from "../utils/helpers.js";

/**
 * The single token-verification implementation used by this backend.
 *
 * The frontend sends the Better Auth session token as `Authorization: Bearer
 * <token>`. We look it up in the shared session collection, reject expired
 * sessions and load the real user document. Everything downstream reads the
 * verified identity from `req.user` — never from the request body or query.
 */
export function unauthorized(res) {
  return res.status(401).json({ error: "Unauthorized" });
}

export async function getUserFromRequest(req) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return null;

  const token = header.slice(7).trim();
  if (!token) return null;

  try {
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
  } catch (error) {
    console.error("Token verification failed:", error);
    return null;
  }
}

export async function verifyToken(req, res, next) {
  const user = await getUserFromRequest(req);
  if (!user) return unauthorized(res);

  req.user = user;
  next();
}

/** Route-level role guard. Must be used after `verifyToken`. */
export function requireRole(...roles) {
  const allowed = roles.map((role) => String(role).toLowerCase());

  return (req, res, next) => {
    if (!req.user) return unauthorized(res);
    if (!allowed.includes(req.user.role)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    next();
  };
}

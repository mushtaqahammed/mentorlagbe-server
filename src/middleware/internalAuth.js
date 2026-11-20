import { INTERNAL_API_SECRET } from "../config/env.js";
import { findUserById } from "../services/userService.js";
import { unauthorized } from "./auth.js";

export function hasInternalSecret(req) {
  return (
    Boolean(INTERNAL_API_SECRET) &&
    String(req.headers["x-internal-secret"] || "") === INTERNAL_API_SECRET
  );
}

export async function requireInternalIdentity(
  req,
  res,
  headerName,
  allowedRoles,
) {
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

export function requireInternalService(req, res) {
  if (!hasInternalSecret(req)) {
    unauthorized(res);
    return false;
  }
  return true;
}

/**
 * Backwards-compatible exports for controllers that still import from here.
 * The actual token verification lives in `verifytoken.js` so there is only one
 * implementation in the backend.
 */
export {
  getUserFromRequest,
  unauthorized,
  verifyToken,
  requireRole,
} from "./verifytoken.js";

/** Convenience helper for tutor-only controllers. */
export function getTutorFromRequest(req) {
  const user = req.user;
  return user && user.role === "tutor" ? user : null;
}

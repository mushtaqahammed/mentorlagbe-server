import { Router } from "express";
import {
  applyToTuition,
  cancelApplication,
  getStudentStats,
  getTutorStats,
  listStudentApplications,
  listTutorApplicants,
  updateApplicationStatus,
} from "../controllers/applicationController.js";
import {
  requireRole,
  verifyToken,
} from "../middleware/verifytoken.js";

const router = Router();

// Student actions.
router.post(
  "/tuitions/:id/apply",
  verifyToken,
  requireRole("student"),
  applyToTuition
);
router.delete(
  "/applications/:id",
  verifyToken,
  requireRole("student"),
  cancelApplication
);
router.get("/student-stats", verifyToken, requireRole("student"), getStudentStats);
router.get(
  "/student-applications",
  verifyToken,
  requireRole("student"),
  listStudentApplications
);

// Tutor actions.
router.get(
  "/tutor-applicants",
  verifyToken,
  requireRole("tutor"),
  listTutorApplicants
);
router.patch(
  "/applications/:id/status",
  verifyToken,
  requireRole("tutor"),
  updateApplicationStatus
);
router.get("/tutor-stats", verifyToken, requireRole("tutor"), getTutorStats);

export default router;

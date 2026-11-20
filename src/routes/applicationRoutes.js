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

const router = Router();

router.post("/tuitions/:id/apply", applyToTuition);
router.get("/tutor-applicants", listTutorApplicants);
router.patch("/applications/:id/status", updateApplicationStatus);
router.delete("/applications/:id", cancelApplication);

router.get("/tutor-stats", getTutorStats);
router.get("/student-stats", getStudentStats);
router.get("/student-applications", listStudentApplications);

export default router;

import { Router } from "express";
import {
  countTuitions,
  createTuition,
  deleteTuition,
  getTuitionById,
  listAllTuitions,
  listFeaturedTuitions,
  listTutorTuitions,
  updateTuition,
  updateTuitionStatus,
} from "../controllers/tuitionController.js";
import {
  requireRole,
  verifyToken,
} from "../middleware/verifytoken.js";

const router = Router();

// Private tutor endpoints — identity comes exclusively from the verified token.
router.get("/tuitions", verifyToken, requireRole("tutor"), listTutorTuitions);
router.get("/tuitions/count", verifyToken, requireRole("tutor"), countTuitions);
router.post("/tuitions", verifyToken, requireRole("tutor"), createTuition);
router.put("/tuitions/:id", verifyToken, requireRole("tutor"), updateTuition);
router.patch(
  "/tuitions/:id/status",
  verifyToken,
  requireRole("tutor"),
  updateTuitionStatus
);
router.delete("/tuitions/:id", verifyToken, requireRole("tutor"), deleteTuition);

// Public browsing endpoints stay open.
router.get("/all-tuitions", listAllTuitions);
router.get("/all-tuitions/:id", getTuitionById);
router.get("/featured-tuitions", listFeaturedTuitions);

export default router;

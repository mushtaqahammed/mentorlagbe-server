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

const router = Router();

router.get("/tuitions", listTutorTuitions);
router.get("/tuitions/count", countTuitions);
router.post("/tuitions", createTuition);
router.put("/tuitions/:id", updateTuition);
router.patch("/tuitions/:id/status", updateTuitionStatus);
router.delete("/tuitions/:id", deleteTuition);

router.get("/all-tuitions", listAllTuitions);
router.get("/all-tuitions/:id", getTuitionById);
router.get("/featured-tuitions", listFeaturedTuitions);

export default router;

import { Router } from "express";
import {
  createTestimonial,
  getTestimonials,
} from "../controllers/testimonialController.js";
import {
  requireRole,
  verifyToken,
} from "../middleware/verifytoken.js";

const router = Router();

router.get("/testimonials", getTestimonials);
router.post(
  "/testimonials",
  verifyToken,
  requireRole("student", "tutor"),
  createTestimonial
);

export default router;

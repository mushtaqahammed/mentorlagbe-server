import { Router } from "express";
import {
  createTestimonial,
  getTestimonials,
} from "../controllers/testimonialController.js";

const router = Router();

router.get("/testimonials", getTestimonials);
router.post("/testimonials", createTestimonial);

export default router;

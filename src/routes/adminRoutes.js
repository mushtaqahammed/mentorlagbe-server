import { Router } from "express";
import {
  getAdminStats,
  getAdminTransactions,
  getAdminTuitions,
  getAdminUsers,
  updateAdminTuitionApproval,
  updateAdminUserRole,
} from "../controllers/adminController.js";
import {
  listAdminTestimonials,
  updateAdminTestimonialStatus,
} from "../controllers/testimonialController.js";

const router = Router();

router.get("/admin/testimonials", listAdminTestimonials);
router.patch("/admin/testimonials/:id", updateAdminTestimonialStatus);

router.get("/admin/users", getAdminUsers);
router.patch("/admin/users/:id/role", updateAdminUserRole);

router.get("/admin/tuitions", getAdminTuitions);
router.patch("/admin/tuitions/:id/approval", updateAdminTuitionApproval);

router.get("/admin/stats", getAdminStats);
router.get("/admin/transactions", getAdminTransactions);

export default router;

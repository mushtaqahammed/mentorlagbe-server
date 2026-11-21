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
  requireRole,
  verifyToken,
} from "../middleware/verifytoken.js";

const router = Router();

const adminOnly = [verifyToken, requireRole("admin")];

router.get("/admin/users", ...adminOnly, getAdminUsers);
router.patch("/admin/users/:id/role", ...adminOnly, updateAdminUserRole);

router.get("/admin/tuitions", ...adminOnly, getAdminTuitions);
router.patch("/admin/tuitions/:id/approval", ...adminOnly, updateAdminTuitionApproval);

router.get("/admin/stats", ...adminOnly, getAdminStats);
router.get("/admin/transactions", ...adminOnly, getAdminTransactions);

export default router;

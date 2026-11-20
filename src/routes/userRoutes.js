import { Router } from "express";
import {
  getInternalUser,
  getUsers,
} from "../controllers/userController.js";
import {
  requireRole,
  verifyToken,
} from "../middleware/verifytoken.js";

const router = Router();

router.get("/users", verifyToken, requireRole("admin"), getUsers);
router.get("/internal/users/:id", getInternalUser);

export default router;

import { Router } from "express";
import {
  getInternalUser,
  getUsers,
} from "../controllers/userController.js";

const router = Router();

router.get("/users", getUsers);
router.get("/internal/users/:id", getInternalUser);

export default router;

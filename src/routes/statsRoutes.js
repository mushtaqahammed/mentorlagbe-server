import { Router } from "express";
import { getPlatformStats } from "../controllers/statsController.js";

const router = Router();

router.get("/platform/stats", getPlatformStats);

export default router;

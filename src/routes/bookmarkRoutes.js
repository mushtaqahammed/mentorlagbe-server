import { Router } from "express"

import {
  addBookmark,
  getBookmarks,
  removeBookmark,
} from "../controllers/bookmarkController.js"
import { requireRole, verifyToken } from "../middleware/verifytoken.js"

const router = Router()

const studentOnly = [verifyToken, requireRole("student")]

router.post("/bookmarks/:tuitionId", ...studentOnly, addBookmark)
router.get("/bookmarks", ...studentOnly, getBookmarks)
router.delete("/bookmarks/:tuitionId", ...studentOnly, removeBookmark)

export default router

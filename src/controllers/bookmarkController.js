import { ObjectId } from "mongodb"

import {
  bookmarksCollection,
  tuitionsCollection,
  usersCollection,
} from "../config/database.js"
import { unauthorized } from "../middleware/verifytoken.js"
import {
  countBookmarks,
  enforceFreeLimit,
  findBookmark,
  insertBookmark,
  isValidTuitionId,
  listBookmarks,
  readStudentAccount,
  removeBookmarkRecord,
  withStudentLock,
  FREE_BOOKMARK_LIMIT,
} from "../services/bookmarkService.js"
import { asString } from "../utils/helpers.js"
import { activeTuitionFilter } from "../utils/tuition.js"

const LIMIT_MESSAGE = `Free students can save up to ${FREE_BOOKMARK_LIMIT} bookmarks. Upgrade to Pro for unlimited bookmarks.`

function requireStudent(req, res) {
  if (!req.user) {
    unauthorized(res)
    return null
  }
  if (String(req.user.role || "").toLowerCase() !== "student") {
    res.status(403).json({ error: "Only students can use bookmarks." })
    return null
  }
  return req.user
}

/** All three endpoints return the same state shape for simple client updates. */
async function sendState(res, userId) {
  const state = await listBookmarks(
    bookmarksCollection,
    usersCollection,
    tuitionsCollection,
    userId,
  )
  if (!state) return unauthorized(res)
  return res.json(state)
}

export async function addBookmark(req, res) {
  try {
    const student = requireStudent(req, res)
    if (!student) return

    const tuitionId = asString(req.params.tuitionId).trim()
    if (!isValidTuitionId(tuitionId)) {
      return res.status(400).json({ error: "Invalid tuition ID." })
    }

    // Only approved, active posts can be saved now. Existing bookmarks that
    // later become unavailable are still listed and can be removed.
    const tuition = await tuitionsCollection.findOne(
      { _id: new ObjectId(tuitionId), ...activeTuitionFilter },
      { projection: { _id: 1 } },
    )
    if (!tuition) {
      return res
        .status(404)
        .json({ error: "Tuition not found or no longer available." })
    }

    const account = await readStudentAccount(usersCollection, student.id)
    if (!account) return unauthorized(res)
    if (!/^student$/i.test(account.role)) {
      return res.status(403).json({ error: "Only students can bookmark tuitions." })
    }
    return withStudentLock(student.id, async () => {
      if (await findBookmark(bookmarksCollection, student.id, tuitionId)) {
        return res.status(409).json({ error: "This tuition is already bookmarked." })
      }
      if (
        !account.pro &&
        (await countBookmarks(bookmarksCollection, student.id)) >=
          FREE_BOOKMARK_LIMIT
      ) {
        return res.status(403).json({ error: LIMIT_MESSAGE })
      }

      let inserted
      try {
        inserted = await insertBookmark(bookmarksCollection, {
          studentId: student.id,
          studentEmail: account.email || student.email,
          tuitionId,
        })
      } catch (error) {
        // The compound unique index is the final defence against duplicates.
        if (error?.code === 11000) {
          const existing = await findBookmark(
            bookmarksCollection,
            student.id,
            tuitionId,
          )
          return res.status(409).json({
            error: existing
              ? "This tuition is already bookmarked."
              : "Could not save this bookmark.",
          })
        }
        throw error
      }

      if (
        !account.pro &&
        (await enforceFreeLimit(bookmarksCollection, student.id, inserted._id))
      ) {
        return res.status(403).json({ error: LIMIT_MESSAGE })
      }

      return sendState(res, student.id)
    })
  } catch (error) {
    console.error("Could not add bookmark:", error)
    return res.status(500).json({ error: "Server error" })
  }
}

export async function getBookmarks(req, res) {
  try {
    if (!requireStudent(req, res)) return
    return sendState(res, req.user.id)
  } catch (error) {
    console.error("Could not load bookmarks:", error)
    return res.status(500).json({ error: "Server error" })
  }
}

export async function removeBookmark(req, res) {
  try {
    const student = requireStudent(req, res)
    if (!student) return

    const tuitionId = asString(req.params.tuitionId).trim()
    if (!isValidTuitionId(tuitionId)) {
      return res.status(400).json({ error: "Invalid tuition ID." })
    }

    const account = await readStudentAccount(usersCollection, student.id)
    if (!account) return unauthorized(res)
    if (!/^student$/i.test(account.role)) {
      return res.status(403).json({ error: "Only students can manage bookmarks." })
    }

    // Removal is scoped to the verified student and always allowed, even when
    // the tuition has since been deleted or made unavailable.
    await removeBookmarkRecord(bookmarksCollection, student.id, tuitionId)

    return sendState(res, student.id)
  } catch (error) {
    console.error("Could not remove bookmark:", error)
    return res.status(500).json({ error: "Server error" })
  }
}

import { ObjectId } from "mongodb"

import { asString, toIsoStringOrNull, toObjectId } from "../utils/helpers.js"

/**
 * Bookmarks live in their own `bookmarks` collection, one document per
 * student/tuition pair. Collections are passed in so the logic stays testable
 * and controllers keep ownership of the app's shared collection handles.
 */
export const FREE_BOOKMARK_LIMIT = 5

const TUITION_ID_PATTERN = /^[a-f\d]{24}$/i
const BOOKMARK_INDEX_NAME = "bookmarks_student_tuition_unique"

let bookmarkIndexPromise = null

/** Serialize a student's add requests in this process. The post-insert
 * reconciliation below still protects against other server instances. */
const pendingByStudent = new Map()

export async function withStudentLock(studentId, task) {
  const key = String(studentId)
  const previous = pendingByStudent.get(key) || Promise.resolve()
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const chained = previous.then(() => gate)
  pendingByStudent.set(key, chained)

  await previous
  try {
    return await task()
  } finally {
    release()
    if (pendingByStudent.get(key) === chained) pendingByStudent.delete(key)
  }
}

export function isValidTuitionId(value) {
  return TUITION_ID_PATTERN.test(String(value || ""))
}

export function isProPlan(value) {
  return asString(value).trim().toLowerCase() === "pro"
}

/** True when a tuition passes the same visibility rule used by public listings. */
export function isAvailableTuition(tuition) {
  if (!tuition) return false
  if (!/^approved$/i.test(asString(tuition.approvalStatus))) return false

  const status = asString(tuition.status).trim().toLowerCase()
  return status === "active" || status === ""
}

/** Compound unique index: one bookmark per (student, tuition), ever. */
export function ensureBookmarksIndex(collection) {
  if (!bookmarkIndexPromise) {
    bookmarkIndexPromise = collection
      .createIndex(
        { studentId: 1, tuitionId: 1 },
        { unique: true, name: BOOKMARK_INDEX_NAME },
      )
      .catch((error) => {
        bookmarkIndexPromise = null
        throw error
      })
  }
  return bookmarkIndexPromise
}

/** Plan and identity come from the user document - never from the request. */
export async function readStudentAccount(usersCollection, userId) {
  const user = await usersCollection.findOne(
    { _id: toObjectId(userId) },
    { projection: { role: 1, email: 1, plan: 1 } },
  )
  if (!user) return null

  const pro = isProPlan(user.plan)
  return {
    id: String(user._id),
    email: asString(user.email),
    role: asString(user.role),
    pro,
    plan: pro ? "pro" : "free",
    limit: pro ? null : FREE_BOOKMARK_LIMIT,
  }
}

export async function countBookmarks(bookmarksCollection, studentId) {
  return bookmarksCollection.countDocuments({ studentId: String(studentId) })
}

export async function findBookmark(bookmarksCollection, studentId, tuitionId) {
  return bookmarksCollection.findOne({
    studentId: String(studentId),
    tuitionId: String(tuitionId),
  })
}

export async function insertBookmark(
  bookmarksCollection,
  { studentId, studentEmail, tuitionId },
) {
  const document = {
    studentId: String(studentId),
    studentEmail: asString(studentEmail),
    tuitionId: String(tuitionId),
    createdAt: new Date(),
  }
  const result = await bookmarksCollection.insertOne(document)
  return { ...document, _id: result.insertedId }
}

export async function removeBookmarkRecord(
  bookmarksCollection,
  studentId,
  tuitionId,
) {
  return bookmarksCollection.deleteOne({
    studentId: String(studentId),
    tuitionId: String(tuitionId),
  })
}

/**
 * A free student may hold at most five rows. If two requests race past the
 * pre-check, the over-limit row (this exact insert) is removed so the cap can
 * never be bypassed; the caller reports the failure to the user.
 */
export async function enforceFreeLimit(
  bookmarksCollection,
  studentId,
  insertedId,
) {
  const count = await countBookmarks(bookmarksCollection, studentId)
  if (count <= FREE_BOOKMARK_LIMIT) return false

  await bookmarksCollection.deleteOne({
    _id: insertedId,
    studentId: String(studentId),
  })
  return true
}

/**
 * Resolve the student's bookmark rows to tuition summaries, newest first.
 * Missing/unavailable tuitions are kept as `available: false` so the UI can
 * show them and still offer a Remove action.
 */
export async function listBookmarks(
  bookmarksCollection,
  usersCollection,
  tuitionsCollection,
  userId,
) {
  const account = await readStudentAccount(usersCollection, userId)
  if (!account) return null

  const docs = await bookmarksCollection
    .find({ studentId: String(userId) })
    .sort({ createdAt: -1, _id: -1 })
    .toArray()

  const ids = docs.map((doc) => String(doc.tuitionId)).filter(isValidTuitionId)
  const objectIds = ids.map((id) => new ObjectId(id))
  const tuitions = objectIds.length
    ? await tuitionsCollection.find({ _id: { $in: objectIds } }).toArray()
    : []

  const tutorIds = [
    ...new Set(tuitions.map((tuition) => asString(tuition.tutorId)).filter(Boolean)),
  ].filter(isValidTuitionId)
  const tutorNames = tutorIds.length
    ? await usersCollection
        .find(
          { _id: { $in: tutorIds.map((id) => new ObjectId(id)) } },
          { projection: { name: 1 } },
        )
        .toArray()
    : []
  const namesById = new Map(
    tutorNames.map((tutor) => [String(tutor._id), asString(tutor.name)]),
  )
  const tuitionById = new Map(
    tuitions.map((tuition) => [String(tuition._id), tuition]),
  )

  const bookmarks = docs.map((doc) => {
    const tuitionId = String(doc.tuitionId)
    const tuition = tuitionById.get(tuitionId)

    if (!tuition) {
      return {
        id: tuitionId,
        bookmarkId: String(doc._id),
        available: false,
        title: "Tuition no longer available",
        subject: null,
        classLevel: null,
        monthlyFee: 0,
        daysPerWeek: 0,
        description: null,
        mode: null,
        location: null,
        bannerImage: null,
        tutorId: null,
        tutorName: "Tutor",
        tutorEmail: null,
        approvalStatus: null,
        status: null,
        createdAt: null,
        savedAt: toIsoStringOrNull(doc.createdAt),
      }
    }

    return {
      id: tuitionId,
      bookmarkId: String(doc._id),
      available: isAvailableTuition(tuition),
      title: asString(tuition.title),
      subject: asString(tuition.subject) || null,
      classLevel: asString(tuition.classLevel) || null,
      monthlyFee: Number(tuition.monthlyFee || 0),
      daysPerWeek: Number(tuition.daysPerWeek || 0),
      description: asString(tuition.description) || null,
      mode: asString(tuition.mode) || null,
      location: asString(tuition.location) || null,
      bannerImage: asString(tuition.bannerImage) || null,
      tutorId: asString(tuition.tutorId) || null,
      tutorName:
        asString(tuition.tutorName).trim() ||
        namesById.get(asString(tuition.tutorId)) ||
        "Tutor",
      tutorEmail: asString(tuition.tutorEmail) || null,
      // Return the values exactly as stored ("Approved" / "Active" in the
      // live collection). Availability is computed separately and safely.
      approvalStatus: asString(tuition.approvalStatus) || null,
      status: asString(tuition.status) || null,
      createdAt: toIsoStringOrNull(tuition.createdAt),
      savedAt: toIsoStringOrNull(doc.createdAt),
    }
  })

  return {
    bookmarks,
    count: bookmarks.length,
    plan: account.plan,
    limit: account.limit,
  }
}

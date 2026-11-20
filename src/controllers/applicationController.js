import {
  applicationsCollection,
  tuitionsCollection,
  usersCollection,
} from "../config/database.js";
import {
  getTutorFromRequest,
  getUserFromRequest,
  unauthorized,
} from "../middleware/auth.js";
import {
  countApplicationStatuses,
  normalizeApplicationStatus,
  serializeApplicant,
  serializeStudentApplication,
} from "../utils/application.js";
import { cleanText, toObjectId } from "../utils/helpers.js";
import { activeTuitionFilter } from "../utils/tuition.js";

export async function applyToTuition(req, res) {
  try {
    const student = await getUserFromRequest(req);
    if (!student) return unauthorized(res);

    if (student.role !== "student") {
      return res
        .status(403)
        .json({ error: "Only students can apply for tuitions." });
    }

    const tuitionId = toObjectId(req.params.id);
    const tuition = await tuitionsCollection.findOne({
      _id: tuitionId,
      ...activeTuitionFilter,
    });

    if (!tuition) {
      return res.status(404).json({ error: "Tuition not found" });
    }

    const existing = await applicationsCollection.findOne({
      tuitionId: tuitionId.toString(),
      studentId: student.id,
    });

    if (existing) {
      return res
        .status(409)
        .json({ error: "You have already applied for this tuition." });
    }

    const now = new Date();
    const phone =
      cleanText(req.body?.phone, 40) || cleanText(student.phone, 40);
    const preferredSchedule = cleanText(req.body?.preferredSchedule, 120);
    const note = cleanText(req.body?.note, 1000);

    const result = await applicationsCollection.insertOne({
      tuitionId: tuitionId.toString(),
      studentId: student.id,
      studentName: student.name,
      studentEmail: student.email,
      phone,
      preferredSchedule,
      note,
      tutorId: String(tuition.tutorId || ""),
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });

    res.status(201).json({ id: result.insertedId.toString(), status: "pending" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
}

export async function listTutorApplicants(req, res) {
  try {
    const tutor = await getTutorFromRequest(req);
    if (!tutor) return unauthorized(res);

    const tutorTuitions = await tuitionsCollection
      .find({ tutorId: tutor.id }, { projection: { _id: 1, title: 1 } })
      .toArray();

    const tuitionTitles = new Map(
      tutorTuitions.map((tuition) => [
        tuition._id.toString(),
        tuition.title || "",
      ]),
    );
    const tuitionIds = [...tuitionTitles.keys()];

    const applications = tuitionIds.length
      ? await applicationsCollection
          .find({ tuitionId: { $in: tuitionIds } })
          .sort({ createdAt: -1 })
          .toArray()
      : [];

    const applicants = applications.map((application) =>
      serializeApplicant(application, tuitionTitles),
    );

    res.json({
      applicants,
      stats: {
        total: applicants.length,
        pending: applicants.filter(
          (applicant) => applicant.status === "pending",
        ).length,
        accepted: applicants.filter(
          (applicant) => applicant.status === "accepted",
        ).length,
        rejected: applicants.filter(
          (applicant) => applicant.status === "rejected",
        ).length,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
}

export async function updateApplicationStatus(req, res) {
  try {
    const tutor = await getTutorFromRequest(req);
    if (!tutor) return unauthorized(res);

    const status = String(req.body?.status || "").toLowerCase();
    if (!["accepted", "rejected"].includes(status)) {
      return res.status(400).json({ error: "Invalid application status." });
    }

    const application = await applicationsCollection.findOne({
      _id: toObjectId(req.params.id),
    });

    if (!application) {
      return res.status(404).json({ error: "Application not found" });
    }

    if (normalizeApplicationStatus(application.status) !== "pending") {
      return res
        .status(409)
        .json({ error: "Only pending applications can be reviewed." });
    }

    const tuition = await tuitionsCollection.findOne({
      _id: toObjectId(application.tuitionId),
      tutorId: tutor.id,
    });

    if (!tuition || String(application.tutorId || "") !== tutor.id) {
      return res.status(404).json({ error: "Application not found" });
    }

    const result = await applicationsCollection.updateOne(
      {
        _id: application._id,
        tutorId: tutor.id,
        tuitionId: application.tuitionId,
        status: { $in: ["Pending", "pending"] },
      },
      {
        $set: {
          status,
          updatedAt: new Date(),
          reviewedBy: tutor.id,
        },
      },
    );

    if (result.matchedCount === 0) {
      return res
        .status(409)
        .json({ error: "Only pending applications can be reviewed." });
    }

    res.json({ id: application._id.toString(), status });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
}

export async function getTutorStats(req, res) {
  try {
    const tutor = await getTutorFromRequest(req);
    if (!tutor) return unauthorized(res);

    const [totalTuitions, activeApprovedTuitions, tutorTuitions] =
      await Promise.all([
        tuitionsCollection.countDocuments({ tutorId: tutor.id }),
        tuitionsCollection.countDocuments({
          tutorId: tutor.id,
          status: "Active",
          approvalStatus: "Approved",
        }),
        tuitionsCollection
          .find({ tutorId: tutor.id }, { projection: { _id: 1 } })
          .toArray(),
      ]);

    const tuitionIds = tutorTuitions.map((tuition) => tuition._id.toString());
    const totalApplicants = tuitionIds.length
      ? await applicationsCollection.countDocuments({
          tuitionId: { $in: tuitionIds },
        })
      : 0;

    res.json({
      totalTuitions,
      activeApprovedTuitions,
      totalApplicants,
      plan: tutor.plan || "free",
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
}

export async function getStudentStats(req, res) {
  try {
    const student = await getUserFromRequest(req);
    if (!student) return unauthorized(res);

    if (student.role !== "student") {
      return res
        .status(403)
        .json({ error: "Only students can view student statistics." });
    }

    const applications = await applicationsCollection
      .find({ studentId: student.id }, { projection: { status: 1 } })
      .toArray();

    const counts = countApplicationStatuses(applications);

    res.json({
      totalApplied: counts.total,
      accepted: counts.accepted,
      pending: counts.pending,
      plan: student.plan || "free",
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
}

export async function listStudentApplications(req, res) {
  try {
    const student = await getUserFromRequest(req);
    if (!student) return unauthorized(res);

    if (student.role !== "student") {
      return res
        .status(403)
        .json({ error: "Only students can view student applications." });
    }

    const applications = await applicationsCollection
      .find({ studentId: student.id })
      .sort({ createdAt: -1, _id: -1 })
      .toArray();

    const tuitionIds = [
      ...new Set(
        applications
          .map((application) => String(application.tuitionId || ""))
          .filter(Boolean),
      ),
    ];
    const tutorIds = [
      ...new Set(
        applications
          .map((application) => String(application.tutorId || ""))
          .filter(Boolean),
      ),
    ];

    const [tuitions, tutors] = await Promise.all([
      tuitionIds.length
        ? tuitionsCollection
            .find(
              { _id: { $in: tuitionIds.map(toObjectId) } },
              {
                projection: {
                  title: 1,
                  monthlyFee: 1,
                  tutorId: 1,
                  tutorName: 1,
                  tutorEmail: 1,
                },
              },
            )
            .toArray()
        : [],
      tutorIds.length
        ? usersCollection
            .find(
              { _id: { $in: tutorIds.map(toObjectId) } },
              { projection: { name: 1, email: 1 } },
            )
            .toArray()
        : [],
    ]);

    const tuitionMap = new Map(
      tuitions.map((tuition) => [tuition._id.toString(), tuition]),
    );
    const tutorMap = new Map(
      tutors.map((tutor) => [tutor._id.toString(), tutor]),
    );

    res.json({
      applications: applications.map((application) => {
        const tuition = tuitionMap.get(String(application.tuitionId || ""));
        const tutor =
          tutorMap.get(String(tuition?.tutorId || "")) ||
          tutorMap.get(String(application.tutorId || ""));

        return serializeStudentApplication(application, tuition, tutor);
      }),
      stats: countApplicationStatuses(applications),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
}

export async function cancelApplication(req, res) {
  try {
    const student = await getUserFromRequest(req);
    if (!student) return unauthorized(res);

    if (student.role !== "student") {
      return res
        .status(403)
        .json({ error: "Only students can cancel their applications." });
    }

    const application = await applicationsCollection.findOne({
      _id: toObjectId(req.params.id),
    });

    if (!application || String(application.studentId || "") !== student.id) {
      return res.status(404).json({ error: "Application not found" });
    }

    if (normalizeApplicationStatus(application.status) !== "pending") {
      return res
        .status(409)
        .json({ error: "Only pending applications can be cancelled." });
    }

    const result = await applicationsCollection.deleteOne({
      _id: application._id,
      studentId: student.id,
      status: { $in: ["Pending", "pending"] },
    });

    if (result.deletedCount === 0) {
      return res
        .status(409)
        .json({ error: "Only pending applications can be cancelled." });
    }

    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
}

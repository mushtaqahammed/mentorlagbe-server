import {
  applicationsCollection,
  tuitionsCollection,
  usersCollection,
} from "../config/database.js";
import { countActiveStudents } from "../services/testimonialService.js";
import { activeTuitionFilter } from "../utils/tuition.js";

export async function getPlatformStats(req, res) {
  try {
    const [verifiedTutors, activeStudents, approvedTuitions, successfulMatches] =
      await Promise.all([
        usersCollection.countDocuments({
          role: /^tutor$/i,
          emailVerified: true,
        }),
        countActiveStudents(),
        tuitionsCollection.countDocuments(activeTuitionFilter),
        applicationsCollection.countDocuments({ status: /^accepted$/i }),
      ]);

    res.json({
      verifiedTutors,
      activeStudents,
      approvedTuitions,
      successfulMatches,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
}

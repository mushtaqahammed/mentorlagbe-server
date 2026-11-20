export function normalizeApplicationStatus(value) {
  const status = String(value || "pending").toLowerCase();
  return ["accepted", "rejected"].includes(status) ? status : "pending";
}

export function countApplicationStatuses(applications) {
  return {
    total: applications.length,
    pending: applications.filter(
      (application) =>
        normalizeApplicationStatus(application.status) === "pending",
    ).length,
    accepted: applications.filter(
      (application) =>
        normalizeApplicationStatus(application.status) === "accepted",
    ).length,
    rejected: applications.filter(
      (application) =>
        normalizeApplicationStatus(application.status) === "rejected",
    ).length,
  };
}

export function serializeApplicant(application, tuitionTitles) {
  const tuitionId = String(application.tuitionId || "");
  const fallbackDate = application._id?.getTimestamp
    ? application._id.getTimestamp()
    : new Date();

  return {
    id: application._id.toString(),
    studentName: application.studentName || "",
    studentEmail: application.studentEmail || "",
    phone: application.phone || "",
    tuitionId,
    tuitionTitle:
      tuitionTitles.get(tuitionId) || "Tuition no longer available",
    preferredSchedule: application.preferredSchedule || "",
    note: application.note || "",
    applicationDate: application.createdAt || fallbackDate,
    status: normalizeApplicationStatus(application.status),
  };
}

export function serializeStudentApplication(application, tuition, tutor) {
  const fallbackDate = application._id?.getTimestamp
    ? application._id.getTimestamp()
    : new Date();

  return {
    id: application._id.toString(),
    tuitionId: String(application.tuitionId || ""),
    tuitionTitle: tuition?.title || "Tuition no longer available",
    tutorName: tuition?.tutorName || tutor?.name || "Tutor",
    tutorEmail: tuition?.tutorEmail || tutor?.email || "",
    monthlyFee: Number(tuition?.monthlyFee || 0),
    applicationDate: application.createdAt || fallbackDate,
    status: normalizeApplicationStatus(application.status),
  };
}

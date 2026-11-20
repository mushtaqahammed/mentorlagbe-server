import { requireInternalService } from "../middleware/internalAuth.js";
import { recordSubscriptionPayment } from "../services/paymentService.js";
import { findUserById } from "../services/userService.js";

export async function recordPayment(req, res) {
  try {
    if (!requireInternalService(req, res)) return;

    const payload = req.body || {};
    const user = await findUserById(payload.userId);
    if (!user) {
      return res.status(404).json({ error: "Account not found" });
    }

    await recordSubscriptionPayment(payload);
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
}

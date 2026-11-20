import { usersCollection } from "../config/database.js";
import { requireInternalService } from "../middleware/internalAuth.js";
import { findUserById } from "../services/userService.js";
import { asString } from "../utils/helpers.js";

export async function getUsers(req, res) {
  const cursor = usersCollection.find({});
  const users = await cursor.toArray();
  res.send(users);
}

export async function getInternalUser(req, res) {
  try {
    if (!requireInternalService(req, res)) return;

    const user = await findUserById(req.params.id);
    if (!user) return res.json(null);

    res.json({
      id: String(user._id),
      role: asString(user.role),
      name: asString(user.name),
      email: asString(user.email),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
}

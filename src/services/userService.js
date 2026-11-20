import { ObjectId } from "mongodb";
import { usersCollection } from "../config/database.js";

export async function findUserById(id) {
  const value = String(id || "").trim();
  if (!value || !ObjectId.isValid(value)) return null;
  return usersCollection.findOne({ _id: new ObjectId(value) });
}

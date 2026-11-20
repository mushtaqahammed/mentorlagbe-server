import dotenv from "dotenv";

dotenv.config();

export const PORT = process.env.PORT || 5000;
export const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || "";

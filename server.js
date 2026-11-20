import express from "express";
import cors from "cors";
import { PORT } from "./src/config/env.js";
import "./src/config/database.js";
import { ensurePaymentsCollection } from "./src/services/paymentService.js";
import {
  adminRoutes,
  applicationRoutes,
  paymentRoutes,
  statsRoutes,
  subscriptionRoutes,
  testimonialRoutes,
  tuitionRoutes,
  userRoutes,
} from "./src/routes/index.js";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.use(userRoutes);
app.use(tuitionRoutes);
app.use(applicationRoutes);
app.use(testimonialRoutes);
app.use(statsRoutes);
app.use(adminRoutes);
app.use(paymentRoutes);
app.use(subscriptionRoutes);

await ensurePaymentsCollection();

app.listen(PORT, () => {
  console.log(`Example app listening on port ${PORT}`);
});

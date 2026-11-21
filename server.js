import express from "express";
import cors from "cors";
import { PORT } from "./src/config/env.js";
import { bookmarksCollection } from "./src/config/database.js";
import { ensureBookmarksIndex } from "./src/services/bookmarkService.js";
import { ensurePaymentsCollection } from "./src/services/paymentService.js";
import {
  adminRoutes,
  applicationRoutes,
  bookmarkRoutes,
  paymentRoutes,
  statsRoutes,
  subscriptionRoutes,
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
app.use(bookmarkRoutes);
app.use(statsRoutes);
app.use(adminRoutes);
app.use(paymentRoutes);
app.use(subscriptionRoutes);

await ensurePaymentsCollection();
try {
  await ensureBookmarksIndex(bookmarksCollection);
} catch (error) {
  console.error("Could not prepare the bookmarks collection:", error);
}

app.listen(PORT, () => {
  console.log(`Example app listening on port ${PORT}`);
});


export default app;
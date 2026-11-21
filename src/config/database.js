import { MongoClient } from "mongodb";
import "./env.js";

const client = new MongoClient(
  `mongodb://${process.env.DB_USER}:${process.env.DB_PASSWORD}@ac-jxjfbm0-shard-00-00.luq0gtl.mongodb.net:27017,ac-jxjfbm0-shard-00-01.luq0gtl.mongodb.net:27017,ac-jxjfbm0-shard-00-02.luq0gtl.mongodb.net:27017/?ssl=true&replicaSet=atlas-6e5ydt-shard-0&authSource=admin`,
);

export async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
    return client;
  } catch (err) {
    console.dir(err);
  }
}

const connectedClient = await connectToMongoDB();
export const database = connectedClient.db("mentor_lagbe");
export const usersCollection = database.collection("user");
export const sessionsCollection = database.collection("session");
export const tuitionsCollection = database.collection("tuition");
export const applicationsCollection = database.collection("application");
export const bookmarksCollection = database.collection("bookmarks");
export const paymentsCollection = database.collection("payments");
export const subscriptionsCollection = database.collection("subscriptions");

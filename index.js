import express from "express";
import { MongoClient } from "mongodb";
import cors from "cors";
import dotenv from "dotenv";


dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

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
const database= connectedClient.db("mentor_lagbe");
const usersCollection = database.collection("user");

const tuitionsCollection = database.collection("tuition");

//middleware

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.get("/users", async (req, res) => {
  const cursor = usersCollection.find({});
  const users = await cursor.toArray();
  res.send(users);
});


//job related api
app.post("/tuitions", async (req, res) => {
  const tuition = req.body;
  const result = await tuitionsCollection.insertOne(tuition);
  res.send(result);
});







app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});

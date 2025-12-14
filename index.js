// index.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { MongoClient, ObjectId, ServerApiVersion } from "mongodb";
import admin from "firebase-admin";
import Stripe from "stripe";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Firebase Admin Setup
const serviceAccount = {
  type: process.env.FIREBASE_TYPE,
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
  private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  client_id: process.env.FIREBASE_CLIENT_ID,
  auth_uri: process.env.FIREBASE_AUTH_URI,
  token_uri: process.env.FIREBASE_TOKEN_URI,
  auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_X509_CERT_URL,
  client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL,
};

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// Stripe Setup
const stripe = new Stripe(process.env.STRIPE_SECRET);

// MongoDB Setup
const client = new MongoClient(process.env.MONGO_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

let db, users, lessons, reports;

// Middleware: Verify Firebase Token
async function verifyToken(req, res, next) {
  if (!req.headers.authorization?.startsWith("Bearer ")) {
    return res.status(401).send({ message: "Unauthorized" });
  }
  const token = req.headers.authorization.split(" ")[1];
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).send({ message: "Invalid Token" });
  }
}

// Middleware: Admin Check
async function isAdmin(req, res, next) {
  const email = req.user.email;
  const user = await users.findOne({ email });
  if (user?.role === "admin") return next();
  return res.status(403).send({ message: "Forbidden: Admin only" });
}

// Start Server & Connect MongoDB
async function run() {
  try {
    await client.connect();
    db = client.db("digitalLife");
    users = db.collection("users");
    lessons = db.collection("lessons");
    reports = db.collection("reports");

    console.log("Connected to MongoDB");

    // ----- USER ROUTES -----
    app.post("/users", async (req, res) => {
      const user = req.body;
      const exist = await users.findOne({ email: user.email });
      if (exist) return res.send({ message: "User already exists" });
      user.role = "user";
      user.isPremium = false;
      user.createdAt = new Date();
      await users.insertOne(user);
      res.send({ message: "User created" });
    });

    app.get("/users/:email", verifyToken, async (req, res) => {
      const user = await users.findOne({ email: req.params.email });
      res.send(user);
    });

    app.get("/admin/users", verifyToken, isAdmin, async (req, res) => {
      const list = await users.find({}).toArray();
      res.send(list);
    });

    // ----- LESSON ROUTES -----
    // Get all lessons (with optional query for filtering)
    app.get("/lessons", async (req, res) => {
      const { category, emotionalTone, keyword, sortBy } = req.query;

      let query = { visibility: "public" };

      if (category) query.category = category;
      if (emotionalTone) query.emotionalTone = emotionalTone;
      if (keyword) query.title = { $regex: keyword, $options: "i" };

      let cursor = lessons.find(query);

      // Sort options
      if (sortBy === "mostSaved")
        cursor = cursor.sort({ "favorites.length": -1 });
      else if (sortBy === "newest") cursor = cursor.sort({ createdAt: -1 });

      const list = await cursor.toArray();
      res.send(list);
    });

    // Get lesson by ID
    app.get("/lessons/:id", verifyToken, async (req, res) => {
      const lesson = await lessons.findOne({
        _id: new ObjectId(req.params.id),
      });

      if (!lesson) return res.status(404).send({ message: "Lesson not found" });

      // Premium lesson check
      const email = req.user?.email;
      if (lesson.accessLevel === "premium") {
        const user = await users.findOne({ email });
        if (!user?.isPremium && email !== lesson.creatorEmail) {
          return res
            .status(403)
            .send({ message: "Upgrade to Premium to view this lesson" });
        }
      }

      res.send(lesson);
    });

    // Add Lesson
    app.post("/lessons", verifyToken, async (req, res) => {
      const user = await users.findOne({ email: req.user.email });
      const data = req.body;

      if (data.accessLevel === "premium" && !user.isPremium) {
        return res
          .status(403)
          .send({ message: "Upgrade to Premium to create premium lesson" });
      }

      data.creatorEmail = req.user.email;
      data.createdAt = new Date();
      data.likes = [];
      data.favorites = [];
      const result = await lessons.insertOne(data);
      res.send(result);
    });

    // Update Lesson
    app.put("/lessons/:id", verifyToken, async (req, res) => {
      const lesson = await lessons.findOne({
        _id: new ObjectId(req.params.id),
      });
      if (!lesson) return res.status(404).send({ message: "Lesson not found" });

      const user = await users.findOne({ email: req.user.email });
      if (lesson.creatorEmail !== req.user.email && user.role !== "admin") {
        return res.status(403).send({ message: "Not authorized" });
      }

      const result = await lessons.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: req.body }
      );
      res.send(result);
    });

    // Delete Lesson
    app.delete("/lessons/:id", verifyToken, async (req, res) => {
      const lesson = await lessons.findOne({
        _id: new ObjectId(req.params.id),
      });
      if (!lesson) return res.status(404).send({ message: "Lesson not found" });

      const user = await users.findOne({ email: req.user.email });
      if (lesson.creatorEmail !== req.user.email && user.role !== "admin") {
        return res.status(403).send({ message: "Not authorized" });
      }

      const result = await lessons.deleteOne({
        _id: new ObjectId(req.params.id),
      });
      res.send(result);
    });

    // Likes & Favorites
    app.post("/lessons/:id/like", verifyToken, async (req, res) => {
      await lessons.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $addToSet: { likes: req.user.email } }
      );
      res.send({ message: "Liked" });
    });

    app.post("/lessons/:id/favorite", verifyToken, async (req, res) => {
      await lessons.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $addToSet: { favorites: req.user.email } }
      );
      res.send({ message: "Favorited" });
    });

    // Report Lesson
    app.post("/report", verifyToken, async (req, res) => {
      const data = req.body;
      data.email = req.user.email;
      data.createdAt = new Date();
      await reports.insertOne(data);
      res.send({ message: "Report submitted" });
    });

    app.get("/admin/reports", verifyToken, isAdmin, async (req, res) => {
      const list = await reports.find({}).toArray();
      res.send(list);
    });

    // ----- PAYMENT -----
    app.post("/create-checkout-session", verifyToken, async (req, res) => {
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        mode: "payment",
        line_items: [
          {
            price_data: {
              currency: "bdt",
              product_data: { name: "Digital Life Lessons Premium" },
              unit_amount: 1500 * 100,
            },
            quantity: 1,
          },
        ],
        success_url: `${process.env.CLIENT_URL}/payment-success`,
        cancel_url: `${process.env.CLIENT_URL}/payment-cancel`,
      });
      res.send({ url: session.url });
    });

    app.post("/payment-success", verifyToken, async (req, res) => {
      await users.updateOne(
        { email: req.user.email },
        { $set: { isPremium: true } }
      );
      res.send({ success: true });
    });
    app.get("/admin/stats", verifyToken, isAdmin, async (req, res) => {
      const totalUsers = await users.countDocuments();
      const totalLessons = await lessons.countDocuments();
      const reportedLessons = await reports.countDocuments();
      res.send({ totalUsers, totalLessons, reportedLessons });
    });
    app.get("/admin/users", verifyToken, isAdmin, async (req, res) => {
      const allUsers = await users.find({}).toArray();
      res.send(allUsers);
    });
    app.get("/admin/lessons", verifyToken, isAdmin, async (req, res) => {
      const allLessons = await lessons.find({}).toArray();
      res.send(allLessons);
    });
    app.get("/admin/reports", verifyToken, isAdmin, async (req, res) => {
      const allReports = await reports.find({}).toArray();
      res.send(allReports);
    });

    // Ping TestJ
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged MongoDB successfully");

    app.listen(process.env.PORT || 5000, () =>
      console.log(`Server running on port ${process.env.PORT || 5000}`)
    );
  } catch (err) {
    console.error(err);
  }
}

run().catch(console.dir);

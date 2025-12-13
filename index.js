const express = require("express");
const stripe = new Stripe(process.env.STRIPE_SECRET);

const cors = require("cors");

const Stripe = require("stripe");
const dotenv = require("dotenv");
const { ObjectId } = require("mongodb");
const admin = require("firebase-admin");
dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());
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

// Verify Firebase Token
async function verifyToken(req, res, next) {
  if (!req.headers.authorization?.startsWith("Bearer ")) {
    return res.status(401).send({ message: "Unauthorized" });
  }

  const token = req.headers.authorization.split(" ")[1];

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).send({ message: "Invalid Token" });
  }
}
// Admin Check
async function isAdmin(req, res, next) {
  const email = req.user.email;

  const user = await users.findOne({ email });

  if (user?.role === "admin") {
    return next();
  }

  return res.status(403).send({ message: "Forbidden: Admin only" });
}
const { MongoClient, ServerApiVersion } = require("mongodb");
const uri = process.env.MONGO_URI;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    db = client.db("digitalLife");
    users = db.collection("users");
    lessons = db.collection("lessons");
    reports = db.collection("reports");

    app.get("/lessons", async (req, res) => {
      const list = await lessons.find({}).toArray();
      res.send(list);
    });
    app.get("/lessons/:id", async (req, res) => {
      const lesson = await lessons.findOne({
        _id: new ObjectId(req.params.id),
      });
      res.send(lesson);
    });
    app.post("/lessons", verifyToken, isAdmin, async (req, res) => {
      const data = req.body;
      data.createdAt = new Date();
      const result = await lessons.insertOne(data);
      res.send(result);
    });
    app.put("/lessons/:id", verifyToken, isAdmin, async (req, res) => {
      const result = await lessons.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: req.body }
      );
      res.send(result);
    });
    app.delete("/lessons/:id", verifyToken, isAdmin, async (req, res) => {
      const result = await lessons.deleteOne({
        _id: new ObjectId(req.params.id),
      });
      res.send(result);
    });
    app.post("/lessons/:id/like", verifyToken, async (req, res) => {
      const userEmail = req.user.email;
      const lessonId = req.params.id;

      await lessons.updateOne(
        { _id: new ObjectId(lessonId) },
        { $addToSet: { likes: userEmail } }
      );

      res.send({ message: "Liked" });
    });
    app.post("/lessons/:id/favorite", verifyToken, async (req, res) => {
      const userEmail = req.user.email;
      const lessonId = req.params.id;

      await lessons.updateOne(
        { _id: new ObjectId(lessonId) },
        { $addToSet: { favorites: userEmail } }
      );

      res.send({ message: "Favorited" });
    });
    app.post("/report", verifyToken, async (req, res) => {
      const data = req.body;
      data.email = req.user.email;
      data.createdAt = new Date();

      await reports.insertOne(data);

      res.send({ message: "Report submitted" });
    });
    app.get("/admin/users", verifyToken, isAdmin, async (req, res) => {
      const list = await users.find({}).toArray();
      res.send(list);
    });

    app.get("/admin/reports", verifyToken, isAdmin, async (req, res) => {
      const list = await reports.find({}).toArray();
      res.send(list);
    });
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
      const email = req.params.email;
      const user = await users.findOne({ email });
      res.send(user);
    });
    app.post("/payment-success", verifyToken, async (req, res) => {
      const email = req.user.email;

      const result = await users.updateOne(
        { email },
        { $set: { isPremium: true } }
      );

      res.send({ success: true });
    });
    const stripe = new Stripe(process.env.STRIPE_SECRET);

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
        success_url: `${process.env.CLIENT_URL}/payment/success`,
        cancel_url: `${process.env.CLIENT_URL}/payment/cancel`,
      });

      res.send({ url: session.url });
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir);

// // backend/scripts/seedAdmin.mjs
// backend/seedAdmin.mjs

import dotenv from "dotenv";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
// import User from "../modules/user/user.model.js";
import User from "./modules/user/user.model.js";
import path from "path";
import { fileURLToPath } from "url";

/* ----------------------------------
   ESM-safe __dirname setup
---------------------------------- */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ----------------------------------
   Load .env explicitly from backend/
---------------------------------- */
// dotenv.config({
//   path: path.resolve(__dirname, "../.env"),
// });
dotenv.config({
  path: path.resolve(__dirname, ".env"),
});


/* ----------------------------------
   Validate Mongo URI
---------------------------------- */
const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error("❌ MONGODB_URI not found in .env");
  process.exit(1);
}

// Optional debug (remove later if you want)
console.log("✅ Loaded Mongo URI");

/* ----------------------------------
   Seed Admin
---------------------------------- */
async function seedAdmin() {
  try {
    await mongoose.connect(MONGO_URI);

    console.log("✅ Connected to MongoDB");

    const phone = "9999999999";
    const password = "Admin@123";

    const passwordHash = await bcrypt.hash(password, 12);

    const existingUser = await User.findOne({ phone });

    if (existingUser) {
      console.log("⚠️ Admin user already exists. Updating…");

      existingUser.role = "SUPER_ADMIN";
      existingUser.passwordHash = passwordHash;
      existingUser.username = "superadmin";

      await existingUser.save();

      console.log("✅ Admin user updated successfully");
      process.exit(0);
    }

    const admin = await User.create({
      name: "Super Admin",
      fullName: "Super Admin",
      username: "superadmin",
      phone,
      passwordHash,
      role: "SUPER_ADMIN",
      phoneVerified: true,
      emailVerified: true,
      classGrade: "Other",
      gender: "Other",
      age: 30,
    });

    console.log("✅ SUPER_ADMIN seeded successfully");
    console.log("📱 Phone:", phone);
    console.log("🔑 Password:", password);
    console.log("👤 Username: superadmin");
    console.log("🆔 Admin ID:", admin._id);

    process.exit(0);
  } catch (error) {
    console.error("❌ Admin seeding failed:", error);
    process.exit(1);
  }
}

seedAdmin();




// import dotenv from "dotenv";
// import mongoose from "mongoose";
// import bcrypt from "bcryptjs";
// import User from "../modules/user/user.model.js";

// dotenv.config();

// const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI;

// if (!MONGO_URI) {
//   throw new Error("MongoDB URI missing in environment variables");
// }

// async function seedAdmin() {
//   try {
//     await mongoose.connect(MONGO_URI);

//     const phone = "9999999999";
//     const password = "Admin@123";

//     const passwordHash = await bcrypt.hash(password, 12);

//     const existingUser = await User.findOne({ phone });

//     if (existingUser) {
//       console.log("⚠️ Admin user already exists, updating role...");
//       existingUser.role = "SUPER_ADMIN";
//       existingUser.passwordHash = passwordHash; // Update password too
//       existingUser.username = "superadmin"; // Set valid username
//       await existingUser.save();
//       console.log("✅ Admin user updated successfully");
//       process.exit(0);
//     }

//     const admin = await User.create({
//       name: "Super Admin",
//       fullName: "Super Admin",
//       username: "superadmin",
//       phone,
//       passwordHash,
//       role: "SUPER_ADMIN",
//       phoneVerified: true,
//       emailVerified: true,
//       classGrade: "Other",
//       gender: "Other",
//       age: 30
//     });

//     console.log("✅ SUPER_ADMIN seeded successfully");
//     console.log("📱 Phone:", phone);
//     console.log("🔑 Password:", password);
//     console.log("👤 Username: superadmin");
//     console.log("🆔 Admin ID:", admin._id);

//     process.exit(0);
//   } catch (error) {
//     console.error("❌ Admin seeding failed:", error);
//     process.exit(1);
//   }
// }

// seedAdmin();

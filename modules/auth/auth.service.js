// modules/auth/auth.service.js
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../user/user.model.js";
import { generateOtp, verifyOtp } from "./otp.service.js";
import { sendOTP } from "../../utils/sms.js";
import { sendEmailOTP } from "../../utils/email.js";

function signTokens(user) {
  const accessToken = jwt.sign(
    { uid: user._id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: "15m" }
  );

  const refreshToken = jwt.sign(
    { uid: user._id },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: "7d" }
  );

  return { accessToken, refreshToken };
}

export async function refreshAccessToken(refreshToken) {
  try {
    const payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    const user = await User.findById(payload.uid);
    if (!user) throw new Error("Invalid refresh token");

    const newAccessToken = jwt.sign(
      { uid: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "15m" }
    );

    return { accessToken: newAccessToken };
  } catch (err) {
    throw new Error("Invalid or expired refresh token");
  }
}

/* ---------------- REGISTER ---------------- */

export async function requestRegisterOtp({ phone, email }) {
  if (!!phone === !!email)
    throw new Error("Provide either phone or email");

  // Check if user already exists and enforce their OTP mode
  let existingUser = null;
  if (phone) {
    existingUser = await User.findOne({ phone });
  } else if (email) {
    existingUser = await User.findOne({ email });
  }

  if (existingUser) {
    // If user exists but doesn't have otpMode set (legacy user), allow either
    if (existingUser.otpMode) {
      // Enforce existing OTP mode
      const requestedMode = phone ? "SMS" : "EMAIL";
      if (existingUser.otpMode !== requestedMode) {
        throw new Error(`OTP must be sent via ${existingUser.otpMode.toLowerCase()}`);
      }
    }
  }

  const key = phone
    ? `otp:register:phone:${phone}`
    : `otp:register:email:${email}`;

  const otp = await generateOtp(key, 'register', phone || email);

  // Send OTP via appropriate channel
  if (phone) {
    try {
      await sendOTP(phone, otp);
    } catch (error) {
      console.error('Failed to send OTP SMS:', error);
      // Don't throw error here - OTP is still valid and stored
      // User can request again if SMS fails
    }
  } else if (email) {
    try {
      await sendEmailOTP(email, otp);
    } catch (error) {
      console.error('Failed to send OTP email:', error);
      // Don't throw error here - OTP is still valid and stored
    }
  }

  return otp; // For development/testing - remove in production
}

export async function registerUser({ phone, email, otp, password, name }) {
  // For development/testing - skip OTP verification
  if (process.env.NODE_ENV === 'development' && !otp) {
    // Skip OTP verification in development
  } else {
    const key = phone
      ? `otp:register:phone:${phone}`
      : `otp:register:email:${email}`;

    await verifyOtp(key, otp, 'register');
  }

  const existing = await User.findOne({
    $or: [{ phone }, { email }]
  });
  if (existing) throw new Error("User already exists");

  const passwordHash = await bcrypt.hash(password, 12);

  // Determine OTP mode and set it immutably
  const otpMode = phone ? "SMS" : "EMAIL";

  const user = await User.create({
    name,
    phone,
    email,
    passwordHash,
    phoneVerified: !!phone,
    isPhoneVerified: !!phone,
    emailVerified: !!email,
    otpMode // Lock OTP mode after first verification
  });

  const tokens = signTokens(user);
  return { user, tokens };
}

/* ---------------- LOGIN ---------------- */

export async function loginUser({ phone, password }) {
  // Only allow login with phone number
  if (!phone) throw new Error("Phone number is required for login");
  if (!password) throw new Error("Password is required");

  // Validate phone number format (10 digits)
  const phoneRegex = /^\d{10}$/;
  if (!phoneRegex.test(phone.replace(/\D/g, ''))) {
    throw new Error("Please enter a valid 10-digit phone number");
  }

  const user = await User.findOne({ phone });
  if (!user) throw new Error("Invalid credentials");

  if (!user.isPhoneVerified) throw new Error("Phone number not verified. Please verify your phone number first.");

  if (!user.passwordHash) throw new Error("Invalid credentials");

  // Validate password is a string before comparing
  if (typeof password !== 'string') {
    throw new Error("Invalid password format");
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) throw new Error("Invalid credentials");

  user.lastLoginAt = new Date();
  await user.save();

  const tokens = signTokens(user);
  return { user, tokens };
}

/* ---------------- ADMIN LOGIN ---------------- */

export async function adminLogin({ phone, password }) {
  // Validate phone number format (10 digits)
  const phoneRegex = /^\d{10}$/;
  if (!phoneRegex.test(phone.replace(/\D/g, ''))) {
    throw new Error("Please enter a valid 10-digit phone number");
  }

  const user = await User.findOne({ 
    phone, 
    role: { $in: ["ADMIN", "SUPER_ADMIN", "QUIZ_ADMIN", "CONTENT_ADMIN"] }
  });
  if (!user) throw new Error("Invalid admin credentials");

  if (!user.passwordHash) throw new Error("Invalid admin credentials");

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) throw new Error("Invalid admin credentials");

  user.lastLoginAt = new Date();
  await user.save();

  const tokens = signTokens(user);
  return { user, tokens };
}

/* ---------------- RESET PASSWORD ---------------- */

export async function requestPasswordReset(phone) {
  if (!phone) throw new Error("Phone required");

  const user = await User.findOne({ phone });
  if (!user) throw new Error("User not found");

  // Enforce OTP mode: password reset must use the user's registered OTP mode
  if (!user.otpMode) {
    throw new Error("User OTP mode not set");
  }

  let key, otp;
  if (user.otpMode === "SMS") {
    key = `otp:reset:phone:${phone}`;
    otp = await generateOtp(key, 'reset', phone);

    try {
      await sendOTP(phone, otp);
    } catch (error) {
      console.error('Failed to send password reset OTP SMS:', error);
      // Don't throw error here - OTP is still valid and stored
    }
  } else if (user.otpMode === "EMAIL") {
    if (!user.email) {
      throw new Error("User email not available for password reset");
    }

    key = `otp:reset:email:${user.email}`;
    otp = await generateOtp(key, 'reset', user.email);

    try {
      await sendEmailOTP(user.email, otp);
    } catch (error) {
      console.error('Failed to send password reset OTP email:', error);
      // Don't throw error here - OTP is still valid and stored
    }
  } else {
    throw new Error("Invalid OTP mode");
  }

  return otp; // For development/testing - remove in production
}

export async function resetPassword({ phone, otp, newPassword }) {
  if (!phone) throw new Error("Phone required");

  const user = await User.findOne({ phone });
  if (!user) throw new Error("User not found");

  // Verify OTP using the user's registered OTP mode
  let key;
  if (user.otpMode === "SMS") {
    key = `otp:reset:phone:${phone}`;
  } else if (user.otpMode === "EMAIL") {
    key = `otp:reset:email:${user.email}`;
  } else {
    throw new Error("Invalid OTP mode");
  }

  await verifyOtp(key, otp, 'reset');

  user.passwordHash = await bcrypt.hash(newPassword, 12);
  await user.save();

  return true;
}

export async function updateFCMToken(userId, fcmToken) {
  const user = await User.findById(userId);
  if (!user) {
    throw new Error('User not found');
  }

  user.fcmToken = fcmToken;
  await user.save();

  return true;
}

export async function updateProfile(userId, updates) {
  const user = await User.findById(userId);
  if (!user) {
    throw new Error('User not found');
  }

  // Define immutable fields that cannot be changed once set
  const immutableFields = ['age', 'gender', 'schoolName', 'classGrade'];

  // Allow updating profile fields, but prevent changing immutable fields once set
  const allowedFields = ['name', 'fullName', 'username', 'email', 'age', 'gender', 'schoolName', 'classGrade', 'profileImage'];
  allowedFields.forEach(field => {
    if (updates[field] !== undefined) {
      // Check if this is an immutable field that already has a value
      if (immutableFields.includes(field) && user[field] !== null && user[field] !== undefined && user[field] !== '') {
        // Field is already set and immutable - skip the update (don't change it)
        // But allow if the value is the same (no actual change)
        if (updates[field] !== user[field]) {
          console.log(`Field ${field} is immutable and already set. Skipping update.`);
          return; // Skip this field, continue with next
        }
      } else {
        // Field can be updated (either not immutable or not yet set)
        user[field] = updates[field];
      }
    }
  });

  // Update name if fullName is provided
  if (updates.fullName && !updates.name) {
    user.name = updates.fullName;
  }

  await user.save();
  return user;
}

export async function deleteAccount(userId) {
  const user = await User.findById(userId);
  if (!user) {
    throw new Error('User not found');
  }

  // Soft delete - anonymize user data
  user.isBlocked = true;
  user.name = 'Deleted User';
  user.phone = null;
  user.email = null;
  user.fcmToken = null;
  user.profileImage = null;
  await user.save();

  // Note: We keep the user record for audit purposes but anonymize personal data
  // Related data (payments, quiz attempts, etc.) should be handled by GDPR compliance features

  return true;
}

export async function getUserPreferences(userId) {
  const user = await User.findById(userId).select('preferences');
  if (!user) {
    throw new Error('User not found');
  }
  return user.preferences || {};
}

export async function updateUserPreferences(userId, preferences) {
  const user = await User.findById(userId);
  if (!user) {
    throw new Error('User not found');
  }
  user.preferences = { ...user.preferences, ...preferences };
  await user.save();
  return user.preferences;
}

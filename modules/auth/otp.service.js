// modules/auth/otp.service.js
import crypto from "crypto";
import redis from "../../config/redis.js";

const OTP_TTL = Number(process.env.OTP_TTL_MS || 180000);
const MAX_ATTEMPTS = 5; // Changed from 3 to 5
const OTP_RATE_LIMIT = 3; // Max OTP requests per 10 min per user
const OTP_RATE_WINDOW = 600000; // 10 min in ms

function hashOtp(otp) {
  return crypto
    .createHmac("sha256", process.env.OTP_HASH_SECRET)
    .update(otp)
    .digest("hex");
}

export async function generateOtp(key, purpose, contact) {
  // Rate limiting: check OTP request frequency
  const rateKey = `otp_rate_${key}`;
  const currentRequests = await redis.get(rateKey);
  const requestCount = currentRequests ? parseInt(currentRequests) : 0;

  if (requestCount >= OTP_RATE_LIMIT) {
    throw new Error("OTP request limit exceeded. Please try again later.");
  }

  const otp = Math.floor(100000 + Math.random() * 900000).toString();

  await redis.setEx(
    key,
    Math.floor(OTP_TTL / 1000),
    JSON.stringify({
      contact,
      purpose,
      hash: hashOtp(otp),
      attempts: 0,
      expiresAt: Date.now() + OTP_TTL,
      consumed: false
    })
  );

  // Increment rate limit counter
  await redis.setEx(rateKey, Math.floor(OTP_RATE_WINDOW / 1000), requestCount + 1);

  return otp;
}

export async function verifyOtp(key, otp, expectedPurpose) {
  const data = await redis.get(key);
  if (!data) throw new Error("OTP expired or invalid");

  const parsed = JSON.parse(data);

  // Check purpose
  if (parsed.purpose !== expectedPurpose) {
    throw new Error("Invalid OTP purpose");
  }

  // Check if already consumed
  if (parsed.consumed) {
    await redis.del(key);
    throw new Error("OTP already used");
  }

  // Check expiration
  if (Date.now() > parsed.expiresAt) {
    await redis.del(key);
    throw new Error("OTP expired");
  }

  if (parsed.attempts >= MAX_ATTEMPTS) {
    await redis.del(key);
    throw new Error("OTP attempts exceeded");
  }

  if (parsed.hash !== hashOtp(otp)) {
    parsed.attempts += 1;
    await redis.setEx(key, Math.floor(OTP_TTL / 1000), JSON.stringify(parsed));
    throw new Error("Invalid OTP");
  }

  // Mark as consumed and delete immediately
  await redis.del(key);
  return true;
}

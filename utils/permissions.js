// utils/permissions.js
import Payment from "../modules/payment/payment.model.js";

export async function isUserEligible(userId, quizDate) {
  const payment = await Payment.findOne({
    user: userId,
    quizDate,
    status: "SUCCESS"
  });
  return Boolean(payment);
}

export async function canViewFullBlog(user) {
  if (!user || !user._id) return false;
  // For MVP, only paid users can view full blog content
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  return await isUserEligible(user._id, today);
}

export async function canDownloadPDF(user) {
  if (!user || !user._id) return false;
  // Only paid users can download PDFs
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  return await isUserEligible(user._id, today);
}

export async function canBeCountedInQuiz(user) {
  if (!user || !user._id) return false;
  // Only paid users are counted in quiz results
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  return await isUserEligible(user._id, today);
}

export function isAdmin(user) {
  return Boolean(user && ['SUPER_ADMIN', 'QUIZ_ADMIN', 'CONTENT_ADMIN'].includes(user.role));
}
// quizAttempt.model.js
import mongoose from "mongoose";

const quizAttemptSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true
    },

    quizDate: {
      type: String,
      index: true
    },

    answers: {
      type: [Number], // selected option index per question
      default: []
    },

    answerTimestamps: {
      type: [Date], // server timestamp when each answer was submitted
      default: []
    },

    questionStartTimes: {
      type: [Date], // server timestamp when each question was sent to client
      default: []
    },

    questionHashes: {
      type: [String], // hash of question content to prevent tampering
      default: []
    },

    questionOrder: {
      type: [Number], // shuffled order of questions (indices into quiz.questions array)
      default: []
    },

    optionOrders: {
      type: [[Number]], // shuffled order of options for each question [[0,1,2,3], [2,0,1,3], ...]
      default: []
    },

    score: {
      type: Number,
      default: 0
    },

    totalTimeMs: {
      type: Number,
      default: 0
    },

    counted: {
      type: Boolean,
      default: true
    },

    answersSaved: {
      type: Boolean,
      default: false
    },

    isEligible: {
      type: Boolean,
      default: false,
      index: true
    },

    eligibilityReason: {
      type: String,
      enum: [
        "PAYMENT_SUCCESS",
        "PAYMENT_MISSING",
        "PAYMENT_REQUIRED",
        "QUIZ_NOT_LIVE",
        "LATE_SUBMISSION",
        "ELIGIBLE",
        "PROFILE_INCOMPLETE"
      ],
      index: true
    },

    eligibilitySnapshotAt: {
      type: Date,
      index: true
    },

    currentQuestionIndex: {
      type: Number,
      default: 0,
      min: 0,
      max: 50
    },

    startedAt: {
      type: Date,
      default: () => new Date()
    },

    completedAt: {
      type: Date
    }
  },
  { timestamps: true }
);

// Compound unique index to prevent double submissions
quizAttemptSchema.index({ user: 1, quizDate: 1 }, { unique: true });

// Index for leaderboard queries
quizAttemptSchema.index({ quizDate: 1, score: -1, totalTimeMs: 1 });

// Additional performance indexes
quizAttemptSchema.index({ quizDate: 1, isEligible: 1, counted: 1, score: -1 }); // For eligible leaderboard
quizAttemptSchema.index({ user: 1, quizDate: -1 }); // For user quiz history// Compound unique index to prevent duplicate attempts
quizAttemptSchema.index({ user: 1, quizDate: 1 }, { unique: true });
quizAttemptSchema.index({ createdAt: -1 }); // For recent attempts

export default mongoose.model("QuizAttempt", quizAttemptSchema);

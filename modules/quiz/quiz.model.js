// modules/quiz/quiz.model.js
import mongoose from "mongoose";

const questionSchema = new mongoose.Schema(
  {
    question: String,
    options: [String],
    correctIndex: Number
  },
  { _id: false }
);

const quizSchema = new mongoose.Schema(
  {
    quizDate: {
      type: String, // YYYY-MM-DD (IST)
      unique: true,
      index: true
    },

    state: {
      type: String,
      enum: ["DRAFT", "SCHEDULED", "LOCKED", "LIVE", "ENDED", "RESULT_PUBLISHED"],
      default: "DRAFT",
      index: true
    },

    questions: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: 'Question' // Reference to Question model
    },

    eligibleUsers: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: 'User',
      default: []
    },

    // Tiered quiz system
    tier: {
      type: String,
      enum: ['BRONZE', 'SILVER', 'GOLD', 'PLATINUM'],
      default: 'BRONZE',
      index: true
    },

    // Tier requirements
    minStreakRequired: {
      type: Number,
      default: 0,
      min: 0
    },

    subscriptionRequired: {
      type: String,
      enum: ['FREE', 'BASIC', 'PREMIUM'],
      default: 'FREE'
    },

    // Class/Grade based quiz filtering
    classGrade: {
      type: String,
      enum: ['10th', '12th', 'Other', 'ALL'],
      default: 'ALL',
      index: true
    },

    lockedAt: Date,
    liveAt: Date,
    endedAt: Date,
    resultPublishedAt: Date
  },
  { timestamps: true }
);

// Virtual for isLive
quizSchema.virtual('isLive').get(function() {
  return this.state === 'LIVE';
});

// Performance indexes
quizSchema.index({ state: 1, quizDate: -1 }); // For active quizzes
quizSchema.index({ quizDate: -1 }); // For date-based queries

export default mongoose.model("Quiz", quizSchema);

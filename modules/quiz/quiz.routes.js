// modules/quiz/quiz.routes.js
import express from "express";
import * as QuizService from "./quiz.service.js";
import Winner from "./winner.model.js";
import { authRequired, eligibilityRequired } from "../../middlewares/auth.middleware.js";
import { quizAttemptRateLimit, quizListRateLimit } from "../../middlewares/rate-limit.middleware.js";
import redis from "../../config/redis.js";

const router = express.Router();

// Middleware to enforce eligibility for quiz actions
const enforceEligibility = async (req, res, next) => {
  try {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const user = req.user;

    if (!user.quizEligibility?.isEligible || user.quizEligibility.eligibleDate !== today) {
      return res.status(403).json({ message: "User not eligible for this quiz" });
    }

    next();
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get today's quiz (for frontend) - Filter by user's class grade
router.get("/today", authRequired, async (req, res) => {
  try {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const quiz = await QuizService.getTodayQuiz(today, req.user._id);
    
    if (!quiz) {
      // Check if quiz exists but user's class doesn't match
      const Quiz = (await import('./quiz.model.js')).default;
      const anyQuiz = await Quiz.findOne({ quizDate: today });
      if (anyQuiz) {
        // Quiz exists but not for this user's class
        const User = (await import('../user/user.model.js')).default;
        const user = await User.findById(req.user._id).select('classGrade');
        return res.json({ 
          exists: false, 
          quiz: null,
          message: `No quiz available for your class. This quiz is for ${anyQuiz.classGrade} class. Your class: ${user?.classGrade || 'Not set'}.`
        });
      }
      return res.json({ exists: false, quiz: null });
    }

    // Check if user has participated
    const QuizAttempt = (await import('./quizAttempt.model.js')).default;
    const attempt = await QuizAttempt.findOne({ user: req.user._id, quizDate: today });

    // Check eligibility
    const { isUserEligible } = await import('../payment/payment.service.js');
    const eligible = await isUserEligible(req.user._id, today);

    // Check if quiz is live
    const isLive = quiz.state === 'LIVE';
    const isCompleted = quiz.state === 'FINALIZED' || quiz.state === 'CLOSED';
    const userParticipated = !!attempt?.answersSaved;

    res.json({
      exists: true,
      quiz: {
        _id: quiz._id,
        quizDate: quiz.quizDate,
        state: quiz.state,
        isLive,
        isCompleted,
        totalQuestions: quiz.questions?.length || 50,
        userParticipated,
        userEligible: eligible,
        classGrade: quiz.classGrade || 'ALL', // Include class grade for frontend display
        lockedAt: quiz.lockedAt,
        liveAt: quiz.liveAt,
        endedAt: quiz.endedAt
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Check eligibility for today's quiz
router.get("/eligibility", authRequired, async (req, res) => {
  try {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const { isUserEligible } = await import('../payment/payment.service.js');
    const eligible = await isUserEligible(req.user._id, today);
    
    // Check if quiz is live
    const quiz = await QuizService.getTodayQuiz(today);
    const quizNotLiveYet = !quiz || quiz.state !== 'LIVE';

    res.json({
      eligible,
      quizNotLiveYet,
      message: eligible 
        ? "You are eligible to participate" 
        : "Payment required to participate"
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Enter quiz (create attempt) - Allow all users to view/attempt, but only paid users' answers count
router.post("/enter", authRequired, quizAttemptRateLimit, async (req, res) => {
  try {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const { quizId } = req.body;

    // Verify quiz exists and is live
    const quiz = await QuizService.getTodayQuiz(today);
    if (!quiz) {
      return res.status(404).json({ message: 'Quiz not found for today' });
    }

    // Check class grade matching
    const User = (await import('../user/user.model.js')).default;
    const user = await User.findById(req.user._id);
    
    // Check if profile is complete (required before quiz participation)
    const { isProfileComplete } = await import('../../utils/quizEligibility.js');
    if (!isProfileComplete(user)) {
      return res.status(403).json({ 
        message: 'Please complete your profile first (Name, Username, Age, Class, School, Gender) before participating in quiz.',
        requiresProfileCompletion: true
      });
    }
    
    if (quiz.classGrade && quiz.classGrade !== 'ALL' && user.classGrade !== quiz.classGrade) {
      return res.status(403).json({ 
        message: `This quiz is for ${quiz.classGrade} class students only. Your class: ${user.classGrade || 'Not set'}` 
      });
    }

    if (quiz.state !== 'LIVE') {
      return res.status(403).json({ message: 'Quiz is not live yet' });
    }

    // Check eligibility
    const { isUserEligible } = await import('../payment/payment.service.js');
    const eligible = await isUserEligible(req.user._id, today);
    
    // Allow all users to create attempts, but mark if eligible
    const attempt = await QuizService.createQuizAttempt(req.user._id, today);
    
    res.json({ 
      success: true, 
      attempt,
      eligible,
      message: eligible 
        ? 'You are eligible - your answers will count'
        : 'You can view and attempt the quiz, but your answers will NOT count until you make payment'
    });
  } catch (error) {
    if (error.message.includes('already started')) {
      return res.status(400).json({ message: error.message, alreadyParticipated: true });
    }
    res.status(400).json({ message: error.message });
  }
});

// Get quiz status (for countdown, etc.)
router.get("/status/:quizDate", authRequired, async (req, res) => {
  try {
    const status = await QuizService.getQuizStatus(req.params.quizDate, req.user._id);
    res.json(status);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Join quiz (create attempt)
router.post("/join/:quizDate", authRequired, quizAttemptRateLimit, async (req, res) => {
  try {
    const attempt = await QuizService.createQuizAttempt(req.user._id, req.params.quizDate);
    res.json(attempt);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Submit answer - api call rate limiting - ALLOW unpaid users to submit (but answers won't count)
router.post("/answer/:quizDate", authRequired, quizAttemptRateLimit, async (req, res) => {
  try {
    const { questionIndex, selectedOptionIndex, timeTakenMs, questionHash } = req.body;
    
    // Allow answer submission even for unpaid users
    // The scoring will mark them as not eligible in finalizeQuizAttempt
    const result = await QuizService.submitAnswer(req.user._id, req.params.quizDate, questionIndex, selectedOptionIndex, timeTakenMs, questionHash);
    
    // Check if user is eligible - return this info to frontend
    const { isUserEligible } = await import('../payment/payment.service.js');
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const eligible = await isUserEligible(req.user._id, today);
    
    res.json({
      ...result,
      eligible,
      message: eligible 
        ? 'Answer recorded and will count' 
        : 'Answer recorded but will not count without payment'
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Get next question - api call rate limiting
// Get current quiz state (current question index for this user)
router.get("/state/:quizDate", authRequired, async (req, res) => {
  try {
    const QuizAttempt = (await import('./quizAttempt.model.js')).default;
    const attempt = await QuizAttempt.findOne({
      user: req.user._id,
      quizDate: req.params.quizDate
    }).select('currentQuestionIndex answers answersSaved startedAt');

    if (!attempt) {
      return res.status(404).json({ message: 'Quiz attempt not found' });
    }

    res.json({
      currentQuestionIndex: attempt.currentQuestionIndex,
      answeredCount: attempt.answers.length,
      totalQuestions: 50,
      startedAt: attempt.startedAt,
      answersSaved: attempt.answersSaved
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.get("/question/:quizDate/:questionIndex", authRequired, quizAttemptRateLimit, async (req, res) => {
  try {
    const questionIndex = parseInt(req.params.questionIndex);
    const question = await QuizService.getNextQuestion(req.user._id, req.params.quizDate, questionIndex);
    res.json(question);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Finish quiz
router.post("/finish/:quizDate", authRequired, quizAttemptRateLimit, async (req, res) => {
  try {
    const attempt = await QuizService.finalizeQuizAttempt(req.user._id, req.params.quizDate);
    res.json(attempt);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Get leaderboard (after results published)
router.get("/leaderboard/:quizDate", quizListRateLimit, async (req, res) => {
  try {
    const leaderboard = await QuizService.getLeaderboard(req.params.quizDate);
    res.json(leaderboard);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get winners (all or by date)
router.get("/winners", quizListRateLimit, async (req, res) => {
  try {
    const { quizDate } = req.query;
    const today = quizDate || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    
    const cacheKey = `winners:${today}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
      return res.json(JSON.parse(cached));
    }
    
    let query = { quizDate: today };
    const winners = await Winner.find(query)
      .populate("user", "name profileImage fullName username")
      .sort({ rank: 1 })
      .limit(20);
    
    const result = winners.map(w => ({
      _id: w._id,
      rank: w.rank,
      score: w.score,
      totalTimeMs: w.totalTimeMs,
      accuracy: w.score > 0 ? ((w.score / 50) * 100).toFixed(2) : 0,
      user: w.user ? {
        _id: w.user._id,
        name: w.user.name || w.user.fullName || w.user.username || 'Unknown',
        profileImage: w.user.profileImage
      } : null,
      quizDate: w.quizDate
    }));
    
    // Cache for 10 minutes
    await redis.setEx(cacheKey, 600, JSON.stringify(result));
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Legacy submit (for compatibility)
router.post("/submit", authRequired, async (req, res) => {
  try {
    const { answers, totalTimeMs, quizDate } = req.body;

    const attempt = await QuizService.finalizeQuizAttempt(req.user._id, quizDate);
    res.json({
      success: true,
      counted: attempt.counted,
      message: attempt.counted
        ? "Submission counted"
        : "Submission recorded but not eligible"
    });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Get user's quiz history (list of all attempts)
router.get("/history", authRequired, async (req, res) => {
  try {
    const analytics = await QuizService.getUserQuizAnalytics(req.user._id);
    res.json({
      quizHistory: analytics.quizHistory || []
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get live analytics for a specific quiz (for quiz analytics page)
router.get("/analytics/:quizId", authRequired, async (req, res) => {
  try {
    const { quizId } = req.params;
    // Get the quiz details
    const Quiz = (await import('./quiz.model.js')).default;
    const quiz = await Quiz.findById(quizId);
    
    if (!quiz) {
      return res.status(404).json({ message: "Quiz not found" });
    }

    // Get all attempts for this quiz
    const QuizAttempt = (await import('./quizAttempt.model.js')).default;
    const attempts = await QuizAttempt.find({ quizDate: quiz.quizDate }).populate('user', 'name username');

    // Get user's personal attempt
    const userAttempt = attempts.find(a => a.user._id.toString() === req.user._id.toString());

    // Calculate analytics
    const totalAttempts = attempts.length;
    const avgScore = attempts.length > 0 ? Math.round(attempts.reduce((sum, a) => sum + a.score, 0) / attempts.length) : 0;
    const maxScore = attempts.length > 0 ? Math.max(...attempts.map(a => a.score)) : 0;
    
    // Get current question index (find the highest question index that has been answered by any participant)
    const currentQuestionIndex = attempts.length > 0 
      ? Math.max(...attempts.map(a => a.currentQuestionIndex || 0))
      : 0;

    res.json({
      quiz: {
        _id: quiz._id,
        title: quiz.title || `Quiz on ${quiz.quizDate}`,
        quizDate: quiz.quizDate,
        state: quiz.state
      },
      analytics: {
        totalParticipants: totalAttempts,
        participantsAnswered: attempts.filter(a => a.submitted).length,
        currentQuestionIndex: currentQuestionIndex,
        totalQuestions: 50, // Standard quiz has 50 questions
        averageScore: avgScore,
        maxScore,
        participantCount: totalAttempts,
        liveCount: attempts.filter(a => !a.submitted).length
      },
      userAttempt: userAttempt ? {
        score: userAttempt.score,
        answered: userAttempt.answers ? userAttempt.answers.length : 0,
        submitted: userAttempt.submitted,
        rank: null
      } : null
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.get("/analytics", authRequired, async (req, res) => {
  try {
    const analytics = await QuizService.getUserQuizAnalytics(req.user._id);
    res.json(analytics);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Save quiz progress
router.post("/progress/:quizDate", authRequired, async (req, res) => {
  try {
    const { currentQuestionIndex, answers, answerTimestamps, questionStartTimes, timeRemaining } = req.body;
    const progress = await QuizService.saveQuizProgress(req.user._id, req.params.quizDate, {
      currentQuestionIndex,
      answers,
      answerTimestamps,
      questionStartTimes,
      timeRemaining
    });
    res.json(progress);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Load quiz progress
router.get("/progress/:quizDate", authRequired, async (req, res) => {
  try {
    const progress = await QuizService.loadQuizProgress(req.user._id, req.params.quizDate);
    res.json(progress || { currentQuestionIndex: 0, answers: [], answerTimestamps: [], questionStartTimes: [], timeRemaining: 900000 });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// New API contracts
// POST /quiz/join
router.post("/join", authRequired, enforceEligibility, quizAttemptRateLimit, async (req, res) => {
  try {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const attempt = await QuizService.createQuizAttempt(req.user._id, today);
    res.json({ success: true, attemptId: attempt._id });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// GET /quiz/status
router.get("/status", async (req, res) => {
  try {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const quiz = await QuizService.getTodayQuiz(today);
    if (!quiz) {
      return res.json({ state: 'NO_QUIZ' });
    }
    res.json({ state: quiz.state, quizDate: quiz.quizDate });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET /quiz/current-question
router.get("/current-question", authRequired, async (req, res) => {
  try {
    const question = await QuizService.getCurrentQuestion(req.user._id);
    res.json(question);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// POST /quiz/answer
router.post("/answer", authRequired, quizAttemptRateLimit, async (req, res) => {
  try {
    const { questionId, selectedOptionIndex } = req.body;
    const result = await QuizService.submitAnswer(req.user._id, questionId, selectedOptionIndex);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// GET /quiz/result
router.get("/result", authRequired, async (req, res) => {
  try {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const result = await QuizService.getLeaderboard(today);
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;

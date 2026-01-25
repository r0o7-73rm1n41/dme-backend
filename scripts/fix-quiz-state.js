#!/usr/bin/env node
/**
 * Fix script to update quiz state from LIVE to ENDED
 * Usage: node scripts/fix-quiz-state.js <quizDate> <mongoUri>
 * Example: node scripts/fix-quiz-state.js 2026-01-25 mongodb+srv://username:password@cluster.mongodb.net/dbname
 */

import mongoose from 'mongoose';
import Quiz from '../modules/quiz/quiz.model.js';

const fixQuizState = async () => {
  try {
    const quizDate = process.argv[2];
    const mongoUri = process.argv[3];
    
    if (!quizDate) {
      console.error('Please provide quizDate as argument');
      console.error('Usage: node scripts/fix-quiz-state.js <quizDate> <mongoUri>');
      console.error('Example: node scripts/fix-quiz-state.js 2026-01-25 mongodb+srv://user:pass@cluster.mongodb.net/dbname');
      process.exit(1);
    }

    if (!mongoUri) {
      console.error('Please provide MongoDB URI as second argument');
      process.exit(1);
    }

    // Connect to MongoDB
    await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 5000,
    });
    console.log('✅ Connected to MongoDB');

    // Find the quiz
    const quiz = await Quiz.findOne({ quizDate });
    if (!quiz) {
      console.log(`❌ Quiz not found for date: ${quizDate}`);
      process.exit(1);
    }

    console.log(`📋 Current quiz state: ${quiz.state}`);
    
    // Update state to ENDED and set endedAt timestamp
    quiz.state = 'ENDED';
    quiz.endedAt = new Date();
    await quiz.save();

    console.log(`✅ Quiz state updated to: ${quiz.state}`);
    console.log(`✅ Ended at: ${quiz.endedAt}`);
    
    // Disconnect
    await mongoose.connection.close();
    console.log('✅ Disconnected from MongoDB');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
};

fixQuizState();

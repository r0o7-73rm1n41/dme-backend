// backend/server.js
import dotenv from 'dotenv';

// Load environment variables FIRST
dotenv.config();

// Enforce Indian timezone globally
process.env.TZ = 'Asia/Kolkata';

// Validate environment variables
import { validateEnvironment } from './config/env-validation.js';
validateEnvironment();

import * as Sentry from '@sentry/node';
import logger from './utils/logger.js';

if (process.env.SENTRY_DSN) {
  Sentry.init({ dsn: process.env.SENTRY_DSN });
  console.log('Sentry initialized');
}

import app from './app.js';
import { startQuizScheduler } from './modules/quiz/quiz.scheduler.js';
import { recoverQuizAdvancement } from './modules/quiz/quiz.service.js';
import redisClient from './config/redis.js';
import connectDB from './config/database.js';
import { createServer } from 'http';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import User from './modules/user/user.model.js';
import ObservabilityService from './modules/monitoring/observability.service.js';

// Socket connection tracking for rate limiting
const socketConnections = new Map(); // IP -> Set of socket IDs
const MAX_SOCKETS_PER_IP = 5;

const PORT = process.env.PORT || 5000;

async function startServer() {
  try {
    // Connect to MongoDB
    await connectDB();

    // Connect to Redis
    try {
      await redisClient.connect();
      console.log('Redis connected');
    } catch (redisError) {
      console.warn('Redis connection failed, continuing without Redis:', redisError.message);
    }

    // Create HTTP server
    const server = createServer(app);
    
    // Setup Socket.IO with auth middleware and performance optimizations
    const io = new Server(server, {
      cors: {
        origin: process.env.NODE_ENV === 'production' 
          ? process.env.FRONTEND_URL || false 
          : "http://localhost:3000",
        methods: ["GET", "POST"],
        credentials: true
      },
      // Performance optimizations
      pingTimeout: 60000, // 60 seconds
      pingInterval: 25000, // 25 seconds
      upgradeTimeout: 10000, // 10 seconds
      maxHttpBufferSize: 1e6, // 1MB max message size
      allowEIO3: true, // Allow Engine.IO v3 clients
      transports: ['websocket', 'polling'], // Prefer websockets
      // Connection limits for performance
      connectTimeout: 10000, // 10 second connection timeout
      // Compression
      perMessageDeflate: {
        threshold: 1024, // Only compress messages > 1KB
        zlibDeflateOptions: {
          level: 6 // Good balance of speed/compression
        }
      }
    });

    // Socket authentication middleware
    io.use(async (socket, next) => {
      try {
        const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.split(' ')[1];
        
        if (!token) {
          return next(new Error('Authentication required'));
        }

        const payload = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(payload.uid).select('-passwordHash');
        
        if (!user) {
          return next(new Error('Invalid user'));
        }

        socket.user = user;
        next();
      } catch (error) {
        console.log('Socket auth failed:', error.message);
        next(new Error('Authentication failed'));
      }
    });

    // Make io available globally
    global.io = io;

// Socket.IO connection handling with rate limiting
    io.on('connection', (socket) => {
      const clientIP = socket.handshake.address;
      console.log(`User ${socket.user.name} connected from ${clientIP}:`, socket.id);

      // Record connection for observability
      ObservabilityService.recordWebSocketConnection(socket.user._id, 'connect');

      // Per-IP connection limiting
      if (!socketConnections.has(clientIP)) {
        socketConnections.set(clientIP, new Set());
      }
      
      const ipSockets = socketConnections.get(clientIP);
      if (ipSockets.size >= MAX_SOCKETS_PER_IP) {
        console.log(`Connection rejected: IP ${clientIP} has ${ipSockets.size} connections (max: ${MAX_SOCKETS_PER_IP})`);
        socket.emit('error', { message: 'Too many connections from this IP' });
        socket.disconnect(true);
        return;
      }

      ipSockets.add(socket.id);

      // Handle quiz room joining
      socket.on('join-quiz', (quizDate) => {
        socket.join(`quiz-${quizDate}`);
        console.log(`User ${socket.user.name} joined quiz room: ${quizDate}`);
      });

      socket.on('leave-quiz', (quizDate) => {
        socket.leave(`quiz-${quizDate}`);
        console.log(`User ${socket.user.name} left quiz room: ${quizDate}`);
      });

      socket.on('disconnect', () => {
        console.log(`User ${socket.user?.name || 'unknown'} disconnected:`, socket.id);
        
        // Record disconnection for observability
        if (socket.user?._id) {
          ObservabilityService.recordWebSocketConnection(socket.user._id, 'disconnect');
        }
        
        // Clean up connection tracking
        const ipSockets = socketConnections.get(clientIP);
        if (ipSockets) {
          ipSockets.delete(socket.id);
          if (ipSockets.size === 0) {
            socketConnections.delete(clientIP);
          }
        }
      });

      // Heartbeat for connection monitoring
      const heartbeat = setInterval(() => {
        socket.emit('ping', Date.now());
      }, 30000); // 30 second heartbeat

      socket.on('pong', (timestamp) => {
        const latency = Date.now() - timestamp;
        socket.latency = latency;
      });

      // Clean up heartbeat on disconnect
      socket.on('disconnect', () => {
        clearInterval(heartbeat);
      });
    });

    // Start server
    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });

    // Start quiz scheduler
    startQuizScheduler();
    
    // Recover quiz advancement for any live quizzes
    await recoverQuizAdvancement();
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

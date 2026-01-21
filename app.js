// backend/app.js
import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import authRoutes from "./modules/auth/auth.routes.js";
import adminRoutes from "./modules/admin/admin.routes.js";
import adminAuthRoutes from "./modules/admin/adminAuth.routes.js";
import blogRoutes from "./modules/blog/blog.routes.js";
import quizRoutes from "./modules/quiz/quiz.routes.js";
import paymentRoutes from "./modules/payment/payment.routes.js";
import userRoutes from "./modules/user/user.routes.js";
import reportRoutes from "./modules/reports/report.routes.js";
import { sanitizeInput } from "./middlewares/sanitization.middleware.js";
import { requestLogger, healthCheck } from "./middlewares/monitoring.middleware.js";
import { generalRateLimit } from "./middlewares/rate-limit.middleware.js";
import * as Sentry from '@sentry/node';

const app = express();

if (process.env.SENTRY_DSN) {
  app.use(Sentry.Handlers.requestHandler());
}

// CORS configuration - MUST be before other middleware that might block preflight requests
// app.use(cors({
//   origin: function (origin, callback) {
//     // Allow requests with no origin (like mobile apps or curl requests)
//     if (!origin) return callback(null, true);
    
//     // List of allowed origins
//     const allowedOrigins = [
//       'http://localhost:3000',
//       'http://localhost:3001',
//       'http://127.0.0.1:3000',
//       'http://127.0.0.1:3001',
//       'https://dme-frontend.vercel.app', // Vercel deployment
//       'https://www.dailymindeducation.com', // Production domain
//       process.env.FRONTEND_URL
//     ].filter(Boolean);
    
//     // Allow if origin is in allowed list or if in development mode
//     if (allowedOrigins.includes(origin) || process.env.NODE_ENV !== 'production') {
//       callback(null, true);
//     } else {
//       callback(new Error('Not allowed by CORS'));
//     }
//   },
//   credentials: true, // Enable credentials (cookies, authorization headers, etc.)
//   methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
//   allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
//   exposedHeaders: ['Authorization'],
//   optionsSuccessStatus: 200 // Some legacy browsers (IE11) choke on 204
// }));
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  'https://dme-frontend.vercel.app',
  'https://www.dailymindeducation.com',
  process.env.FRONTEND_URL
].filter(Boolean);

app.use(cors({
  origin: function(origin, callback) {
    // allow non-browser requests (curl, Postman)
    if (!origin) return callback(null, true);

    // allow if in allowed list
    if (allowedOrigins.some(o => o === origin)) {
      return callback(null, true);
    }

    console.warn(`Blocked CORS request from: ${origin}`);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  exposedHeaders: ['Authorization'],
  optionsSuccessStatus: 200
}));

// Compression middleware for better performance
app.use(compression({
  level: 6, // Good balance between compression and speed
  threshold: 1024, // Only compress responses larger than 1KB
  filter: (req, res) => {
    if (req.headers['x-no-compression']) {
      return false;
    }
    return compression.filter(req, res);
  }
}));

// Apply global API rate limiter - Skip OPTIONS preflight and auth endpoints
app.use('/api', (req, res, next) => {
  if (req.method === 'OPTIONS') {
    return next(); // Skip rate limiting for preflight requests
  }
  
  // Completely skip rate limiting for auth endpoints
  if (req.path.startsWith('/auth/') || req.path.startsWith('/admin-auth/')) {
    return next();
  }
  
  // Skip rate limiting in development
  if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'dev') {
    return next();
  }
  
  // Apply general rate limit to remaining endpoints
  return generalRateLimit(req, res, next);
});

// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:", "http:"],
      connectSrc: ["'self'", "ws:", "wss:"],
    },
  },
}));

// Input sanitization
app.use(sanitizeInput);

app.use(express.json());

// Health check endpoint
app.get('/health', healthCheck);

app.use("/api/auth", authRoutes);
app.use("/api/admin-auth", adminAuthRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/blogs", blogRoutes);
app.use("/api/quiz", quizRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api", userRoutes);
app.use("/api/reports", reportRoutes);

if (process.env.SENTRY_DSN) {
  app.use(Sentry.Handlers.errorHandler());
}

export default app;

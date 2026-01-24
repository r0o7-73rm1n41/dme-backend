# Daily Mind Education - Backend

Production-grade backend for the Daily Live Quiz Platform with comprehensive anti-cheat measures.

## Features

- 🔒 **Anti-Cheat Security**: Device tracking, timing validation, and suspicious activity monitoring
- 📊 **Real-time Quiz System**: Live quiz management with Socket.io
- 💳 **Payment Integration**: Razorpay payment processing
- 📱 **OTP Authentication**: SMS and Email OTP support
- 📈 **Analytics & Monitoring**: Comprehensive observability and admin dashboard
- 🗄️ **Database**: MongoDB with Mongoose ODM
- ⚡ **Caching**: Redis for performance optimization

## Tech Stack

- **Runtime**: Node.js with ES6 modules
- **Framework**: Express.js
- **Database**: MongoDB Atlas
- **Cache**: Upstash Redis
- **Authentication**: JWT tokens
- **Validation**: Joi schemas
- **Real-time**: Socket.io
- **File Storage**: Cloudinary
- **Payments**: Razorpay
- **SMS**: 2Factor.in
- **Email**: Nodemailer

## Environment Variables

Create a `.env` file with the following variables:

```env
# Server
PORT=5000
NODE_ENV=production

# Database
MONGODB_URI=mongodb+srv://...

# Redis (Upstash)
UPSTASH_REDIS_REST_URL=https://...
UPSTASH_REDIS_REST_TOKEN=...

# JWT
JWT_SECRET=your_jwt_secret
JWT_REFRESH_SECRET=your_refresh_secret

# OTP
OTP_HASH_SECRET=your_otp_secret
OTP_TTL_MS=180000

# Email (optional)
EMAIL_USER=your_email@gmail.com
EMAIL_APP_PASSWORD=your_app_password

# SMS (required)
TWOFACTOR_API_KEY=your_2factor_api_key
OTP_PROVIDER_KEY=your_provider_key

# Cloudinary
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret

# Razorpay
RAZORPAY_KEY_ID=your_razorpay_key_id
RAZORPAY_KEY_SECRET=your_razorpay_key_secret

# Monitoring (optional)
SENTRY_DSN=your_sentry_dsn
```

## Installation

```bash
npm install
```

## Development

```bash
npm run dev
```

## Production

```bash
npm start
```

## API Documentation

### Authentication
- `POST /auth/register-otp` - Request OTP for registration
- `POST /auth/verify-otp` - Verify OTP and register
- `POST /auth/login` - User login
- `POST /auth/refresh` - Refresh access token

### Quiz System
- `GET /quiz/today` - Get today's quiz status
- `POST /quiz/enter` - Enter quiz (create attempt)
- `POST /quiz/answer/:quizDate` - Submit answer
- `GET /quiz/state/:quizDate` - Get quiz state
- `GET /quiz/leaderboard/:quizDate` - Get leaderboard

### Admin Panel
- `GET /admin/dashboard` - Admin dashboard stats
- `POST /admin/quiz` - Create quiz
- `GET /admin/anticheat/events/:quizDate` - Anti-cheat events
- `GET /admin/anticheat/user/:userId` - User anti-cheat history

## Deployment

### Backend (Railway)
1. Connect your GitHub repository to Railway
2. Set environment variables in Railway dashboard
3. Deploy automatically on push

### Frontend (Vercel)
1. Connect your GitHub repository to Vercel
2. Set `VITE_API_URL` environment variable to your backend URL
3. Deploy automatically on push

## Security Features

- **Device Tracking**: Prevents cross-device cheating
- **Timing Validation**: Blocks rapid automated answers
- **Rate Limiting**: Prevents abuse and spam
- **Input Validation**: Comprehensive Joi schemas
- **Server-side Enforcement**: No client trust architecture
- **Audit Logging**: All admin actions logged
- **Anti-cheat Monitoring**: Suspicious activity detection

## License

Private - Daily Mind Education

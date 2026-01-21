// config/env-validation.js
import Joi from 'joi';

const envSchema = Joi.object({
  // Server
  PORT: Joi.number().default(5000),
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),

  // Database
  MONGODB_URI: Joi.string().when('NODE_ENV', { is: 'production', then: Joi.required(), otherwise: Joi.string().default('mongodb://localhost:27017/dme') }),

  // Redis
  REDIS_URL: Joi.string().default('redis://localhost:6379'),

  // JWT
  JWT_SECRET: Joi.string().when('NODE_ENV', { is: 'production', then: Joi.required(), otherwise: Joi.string().default('dev_jwt_secret') }),
  JWT_REFRESH_SECRET: Joi.string().when('NODE_ENV', { is: 'production', then: Joi.required(), otherwise: Joi.string().default('dev_refresh_secret') }),

  // OTP
  OTP_HASH_SECRET: Joi.string().when('NODE_ENV', { is: 'production', then: Joi.required(), otherwise: Joi.string().default('dev_otp_secret') }),
  OTP_TTL_MS: Joi.number().default(180000),

  // Email (optional for now)
  EMAIL_USER: Joi.string().optional(),
  EMAIL_APP_PASSWORD: Joi.string().optional(),

  // SMS (required in production)
  TWOFACTOR_API_KEY: Joi.string().when('NODE_ENV', { is: 'production', then: Joi.required(), otherwise: Joi.string().default('') }),
  OTP_PROVIDER_KEY: Joi.string().when('NODE_ENV', { is: 'production', then: Joi.required(), otherwise: Joi.string().default('') }),

  // Cloudinary (optional in development)
  CLOUDINARY_CLOUD_NAME: Joi.string().when('NODE_ENV', { is: 'production', then: Joi.required(), otherwise: Joi.string().default('') }),
  CLOUDINARY_API_KEY: Joi.string().when('NODE_ENV', { is: 'production', then: Joi.required(), otherwise: Joi.string().default('') }),
  CLOUDINARY_API_SECRET: Joi.string().when('NODE_ENV', { is: 'production', then: Joi.required(), otherwise: Joi.string().default('') }),

  // Razorpay (optional in development)
  RAZORPAY_KEY_ID: Joi.string().when('NODE_ENV', { is: 'production', then: Joi.required(), otherwise: Joi.string().default('your_razorpay_key_id') }),
  RAZORPAY_KEY_SECRET: Joi.string().when('NODE_ENV', { is: 'production', then: Joi.required(), otherwise: Joi.string().default('your_razorpay_key_secret') }),
  RAZORPAY_WEBHOOK_SECRET: Joi.string().when('NODE_ENV', { is: 'production', then: Joi.required(), otherwise: Joi.string().default('') }),

  // Timezone
  TZ: Joi.string().default('Asia/Kolkata'),

}).unknown(); // Allow unknown env vars

export function validateEnvironment() {
  const { error, value } = envSchema.validate(process.env, { allowUnknown: true });

  if (error) {
    console.error('Environment validation failed:', error.details);
    throw new Error(`Environment validation failed: ${error.details.map(d => d.message).join(', ')}`);
  }

  // Set defaults
  Object.keys(value).forEach(key => {
    if (value[key] !== undefined) {
      process.env[key] = value[key];
    }
  });

  console.log('✅ Environment variables validated successfully');
  return value;
}
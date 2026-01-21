// middlewares/sanitization.middleware.js
import validator from 'validator';

export const sanitizeInput = (req, res, next) => {
  // Sanitize string fields in req.body, req.query, req.params
  const sanitizeObject = (obj) => {
    for (let key in obj) {
      if (typeof obj[key] === 'string') {
        // Trim whitespace
        obj[key] = validator.trim(obj[key]);
        // Escape HTML
        obj[key] = validator.escape(obj[key]);
        // Remove potential XSS
        obj[key] = validator.stripLow(obj[key]);
      } else if (typeof obj[key] === 'object' && obj[key] !== null) {
        sanitizeObject(obj[key]);
      }
    }
  };

  if (req.body) sanitizeObject(req.body);
  if (req.query) sanitizeObject(req.query);
  if (req.params) sanitizeObject(req.params);

  next();
};
// // config/redis.js
// config/redis.js
import { Redis } from '@upstash/redis';

let redisClient;

if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
  redisClient = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
  console.log('Connected to Upstash Redis via REST');
} else {
  // Mock Redis for local dev / testing
  const store = new Map();
  if (typeof global !== 'undefined') global.redisStore = store;

  redisClient = {
    connect: () => Promise.resolve(),
    set: (key, value) => { store.set(key, value); return Promise.resolve('OK'); },
    get: (key) => Promise.resolve(store.get(key) || null),
    setEx: (key, ttl, value) => { store.set(key, value); return Promise.resolve('OK'); },
    del: (key) => { store.delete(key); return Promise.resolve(1); },
    ping: () => Promise.resolve('PONG'),
  };

  console.log('Using mock Redis');
}

export default redisClient;

// import { createClient } from 'redis';

// let redisClient;

// if (process.env.REDIS_URL && process.env.REDIS_URL !== 'redis://your_upstash_redis_url_here') {
//   redisClient = createClient({
//     url: process.env.REDIS_URL
//   });
//   redisClient.on('error', (err) => console.error('Redis Client Error', err));
//   // Connect lazily to avoid top-level await
//   redisClient.connect().catch(err => console.error('Redis connection failed:', err));
// } else {
//   // Mock Redis for MVP and testing
//   const store = new Map();

//   // Make store globally accessible for test cleanup
//   if (typeof global !== 'undefined') {
//     global.redisStore = store;
//   }

//   redisClient = {
//     connect: () => Promise.resolve(),
//     set: (key, value, ...args) => {
//       store.set(key, value);
//       return Promise.resolve('OK');
//     },
//     get: (key) => {
//       return Promise.resolve(store.get(key) || null);
//     },
//     setEx: (key, ttl, value) => {
//       store.set(key, value);
//       return Promise.resolve('OK');
//     },
//     exists: (key) => {
//       return Promise.resolve(store.has(key) ? 1 : 0);
//     },
//     incr: (key) => {
//       const current = store.get(key) || 0;
//       const newValue = parseInt(current) + 1;
//       store.set(key, newValue.toString());
//       return Promise.resolve(newValue);
//     },
//     del: (key) => {
//       store.delete(key);
//       return Promise.resolve(1);
//     },
//     expire: () => Promise.resolve(1),
//     lpush: (key, value) => {
//       const current = store.get(key);
//       let list = [];
//       if (current) {
//         try {
//           list = JSON.parse(current);
//           if (!Array.isArray(list)) {
//             list = [current]; // If it's not an array, treat it as a single item
//           }
//         } catch (e) {
//           list = [current]; // If it's not JSON, treat it as a single item
//         }
//       }
//       list.unshift(value);
//       store.set(key, JSON.stringify(list));
//       return Promise.resolve(list.length);
//     },
//     setex: (key, ttl, value) => {
//       store.set(key, value);
//       // Mock TTL - in real Redis this would expire after ttl seconds
//       return Promise.resolve('OK');
//     },
//     ltrim: (key, start, end) => {
//       const current = store.get(key);
//       if (!current) return Promise.resolve(0);
      
//       let list = [];
//       try {
//         list = JSON.parse(current);
//         if (!Array.isArray(list)) {
//           list = [current];
//         }
//       } catch (e) {
//         list = [current];
//       }
      
//       const trimmed = list.slice(start, end + 1);
//       store.set(key, JSON.stringify(trimmed));
//       return Promise.resolve(trimmed.length);
//     },
//     lrange: (key, start, end) => {
//       const current = store.get(key);
//       if (!current) return Promise.resolve([]);
      
//       let list = [];
//       try {
//         list = JSON.parse(current);
//         if (!Array.isArray(list)) {
//           list = [current];
//         }
//       } catch (e) {
//         list = [current];
//       }
      
//       const result = list.slice(start, end === -1 ? undefined : end + 1);
//       return Promise.resolve(result);
//     },
//     hgetall: (key) => {
//       const current = store.get(key);
//       if (!current) return Promise.resolve({});
      
//       try {
//         const hash = JSON.parse(current);
//         return Promise.resolve(hash);
//       } catch (e) {
//         return Promise.resolve({});
//       }
//     },
//     hincrby: (key, field, increment) => {
//       const current = store.get(key);
//       let hash = {};
//       if (current) {
//         try {
//           hash = JSON.parse(current);
//         } catch (e) {
//           hash = {};
//         }
//       }
      
//       const currentValue = parseInt(hash[field] || 0);
//       hash[field] = currentValue + increment;
//       store.set(key, JSON.stringify(hash));
//       return Promise.resolve(hash[field]);
//     },
//     ping: () => Promise.resolve('PONG'),
//     keys: (pattern) => {
//       const keys = Array.from(store.keys()).filter(key => {
//         // Simple pattern matching for * wildcard
//         const regex = new RegExp(pattern.replace(/\*/g, '.*'));
//         return regex.test(key);
//       });
//       return Promise.resolve(keys);
//     },
//     connected: false
//   };
//   console.log('Using mock Redis for MVP');
// }

// export default redisClient;

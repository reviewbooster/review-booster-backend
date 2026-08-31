'use strict';

/**
 * app.js — Express application setup
 *
 * Responsibility: configure middleware, mount routes.
 * Does NOT call listen() — that lives in server.js so tests can import
 * this file without binding a port.
 */

require('dotenv').config();

// Error monitoring -- activate by setting SENTRY_DSN on Railway
if (process.env.SENTRY_DSN) {
  const Sentry = require('@sentry/node');
  Sentry.init({ dsn: process.env.SENTRY_DSN, environment: process.env.NODE_ENV || 'development' });
}

const express      = require('express');
const cors         = require('cors');
const cookieParser = require('cookie-parser');
const morgan       = require('morgan');

const connectDB             = require('./config/db');
const authRoutes      = require('./routes/auth.routes');
const customerRoutes  = require('./routes/customer.routes');
const requestRoutes   = require('./routes/request.routes');
const publicRoutes    = require('./routes/public.routes');
const reviewRoutes    = require('./routes/review.routes');
const analyticsRoutes = require('./routes/analytics.routes');
const { globalErrorHandler } = require('./middleware/errorHandler');

// ─────────────────────────────────────────────────────────────────────────────
// Boot database connection
// ─────────────────────────────────────────────────────────────────────────────
connectDB();

// ─────────────────────────────────────────────────────────────────────────────
// App
// ─────────────────────────────────────────────────────────────────────────────
const app = express();

// ── CORS ────────────────────────────────────────────────────────────────────
const allowedOrigins = [
  process.env.FRONTEND_URL || 'http://localhost:3000',
];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (Postman, curl, server-to-server)
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,   // Required for cookies to be sent cross-origin
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// ── Body parsers ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10kb' }));       // Guard against large payloads
app.use(express.urlencoded({ extended: false }));

// ── Cookie parser (needed for httpOnly refresh token) ────────────────────────
app.use(cookieParser());

// ── HTTP request logging ─────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}

// ─────────────────────────────────────────────────────────────────────────────
// Health check (UptimeRobot pings this every 5 minutes)
// ─────────────────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));

// ─────────────────────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));

app.use('/api/auth', authRoutes);

// Week 2 routes
// Public review route gets its own tighter rate limiter — customers tapping links
const rateLimit    = require('express-rate-limit');
const publicLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30,
  message: { error: 'Too many requests, please slow down.' },
});

app.use('/api/r',          publicLimiter,  publicRoutes);
app.use('/api/customers',                  customerRoutes);
app.use('/api/requests',                   requestRoutes);
app.use('/api/reviews',                    reviewRoutes);
app.use('/api/analytics',                  analyticsRoutes);
app.use('/api/business',   require('./routes/business.routes'));
app.use('/api/notifications', require('./routes/notification.routes'));
app.use('/api/qr-templates',  require('./routes/qrTemplate.routes'));
app.use('/api/admin',     require('./routes/admin.routes'));

// ─────────────────────────────────────────────────────────────────────────────
// 404 handler — must come BEFORE the global error handler
// ─────────────────────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found.' });
});

// ─────────────────────────────────────────────────────────────────────────────
// Global error handler — must be LAST (4-argument signature required)
// ─────────────────────────────────────────────────────────────────────────────
app.use(globalErrorHandler);

module.exports = app;

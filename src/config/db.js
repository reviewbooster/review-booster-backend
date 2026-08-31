'use strict';

const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
const mongoose = require('mongoose');

/**
 * Connect to MongoDB Atlas via Mongoose.
 * Exits the process immediately on first connection failure
 * so the orchestration layer (Railway, Docker, PM2) can restart.
 * After initial connect, Mongoose manages the connection pool and
 * fires 'disconnected' / 'reconnected' events automatically.
 */
const connectDB = async () => {
  const uri = process.env.MONGO_URI;

  if (!uri) {
    console.error('[DB] MONGO_URI is not defined in environment variables.');
    process.exit(1);
  }

  try {
    const conn = await mongoose.connect(uri, {
      // Mongoose 7+ ignores most legacy options, but these are still respected
      serverSelectionTimeoutMS: 10_000,  // fail fast on bad URI
      socketTimeoutMS: 45_000,
    });

    console.log(`[DB] MongoDB connected: ${conn.connection.host}`);

    // ------------------------------------------------------------------
    // Connection lifecycle events
    // ------------------------------------------------------------------
    mongoose.connection.on('disconnected', () => {
      console.warn('[DB] MongoDB disconnected. Mongoose will attempt to reconnect.');
    });

    mongoose.connection.on('reconnected', () => {
      console.log('[DB] MongoDB reconnected.');
    });

    mongoose.connection.on('error', (err) => {
      console.error('[DB] MongoDB connection error:', err.message);
    });

  } catch (err) {
    console.error('[DB] Initial MongoDB connection failed:', err.message);
    process.exit(1);
  }
};

module.exports = connectDB;

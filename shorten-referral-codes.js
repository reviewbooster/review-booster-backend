'use strict';
require('dotenv').config();
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first'); // same Jio/WARP workaround as the main app

const mongoose = require('mongoose');
const nodeCrypto = require('crypto');
const Referral = require('./src/models/Referral');

const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
function generateShortCode() {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += CODE_ALPHABET[nodeCrypto.randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('MONGO_URI is not set — make sure you run this from the backend repo root.');
    process.exit(1);
  }

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  console.log('Connected to MongoDB.');

  const longCodes = await Referral.find({ $expr: { $gt: [{ $strLenCP: '$code' }, 6] } });
  console.log('Found', longCodes.length, 'referral(s) with a long code to shorten.');

  for (const referral of longCodes) {
    const oldCode = referral.code;
    let newCode;
    let attempts = 0;
    do {
      newCode = generateShortCode();
      attempts++;
    } while (await Referral.exists({ code: newCode }) && attempts < 20);

    referral.code = newCode;
    await referral.save();
    console.log('  ' + oldCode + '  ->  ' + newCode);
  }

  console.log('Done. All referral counts and customer data are unchanged — only the codes themselves were shortened.');

  await mongoose.disconnect();
}

main().catch(function (err) {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
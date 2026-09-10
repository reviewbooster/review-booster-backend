'use strict';

const mongoose = require('mongoose');

const { Schema } = mongoose;

/**
 * staff_members collection
 * A lightweight "who served this customer" directory entry — just a name,
 * scoped to a business. Deliberately NOT a login account: no email,
 * password, or role. Completely separate from the User model (which is
 * what powers actual staff login accounts on the Team page). A business
 * that doesn't want attribution never has to touch this at all.
 */
const StaffMemberSchema = new Schema(
  {
    business_id: {
      type: Schema.Types.ObjectId,
      ref: 'Business',
      required: [true, 'business_id is required'],
    },
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      maxlength: 60,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

StaffMemberSchema.index({ business_id: 1, name: 1 });

module.exports = mongoose.model('StaffMember', StaffMemberSchema);

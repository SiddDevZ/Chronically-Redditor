import mongoose from 'mongoose';

const dailyRoastUsageSchema = new mongoose.Schema({
  day: { type: String, required: true, unique: true },
  count: { type: Number, default: 0, min: 0 },
  expiresAt: { type: Date, required: true, expires: 0 },
}, { timestamps: true });

const DailyRoastUsage = mongoose.model('DailyRoastUsage', dailyRoastUsageSchema);

export default DailyRoastUsage;

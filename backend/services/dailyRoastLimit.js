import DailyRoastUsage from '../models/DailyRoastUsage.js';

const DAILY_ROAST_LIMIT = 100;

function getUtcDay(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

function getResetAt(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

function getExpiresAt(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 8));
}

async function reserveDailyRoast({ model = DailyRoastUsage, now = new Date() } = {}) {
  const day = getUtcDay(now);
  const resetAt = getResetAt(now);

  try {
    await model.updateOne(
      { day },
      { $setOnInsert: { day, count: 0, expiresAt: getExpiresAt(now) } },
      { upsert: true }
    );
  } catch (error) {
    if (error?.code !== 11000) throw error;
  }

  const usage = await model.findOneAndUpdate(
    { day, count: { $lt: DAILY_ROAST_LIMIT } },
    { $inc: { count: 1 } },
    { new: true }
  );
  const count = usage?.count ?? DAILY_ROAST_LIMIT;
  return { allowed: Boolean(usage), day, count, remaining: Math.max(0, DAILY_ROAST_LIMIT - count), resetAt };
}

async function releaseDailyRoast(day, { model = DailyRoastUsage } = {}) {
  if (!day) return;
  await model.findOneAndUpdate({ day, count: { $gt: 0 } }, { $inc: { count: -1 } });
}

export { DAILY_ROAST_LIMIT, getUtcDay, getResetAt, reserveDailyRoast, releaseDailyRoast };

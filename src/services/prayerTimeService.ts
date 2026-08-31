import schedule from "node-schedule";
import webpush from "web-push";
import { Coordinates, CalculationMethod, PrayerTimes } from "adhan";
import User from "../models/user.model";
import logger from "../config/logger";
import dotenv from "dotenv";

if (process.env.NODE_ENV !== "production") {
  dotenv.config();
}

// True once VAPID details are configured; guards every push send/schedule so
// a disabled deployment never throws from web-push.
let pushReady = false;

export const isPushReady = () => pushReady;

// Set up web-push VAPID details
export const initWebPush = () => {
  const pushEnabled = process.env.PUSH_NOTIFICATIONS_ENABLED === "true";
  if (!pushEnabled) {
    logger.info("Push notifications are disabled by configuration");
    return false;
  }

  const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
  const vapidSubject = process.env.VAPID_SUBJECT;

  if (!vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
    throw new Error(
      "Push notifications are enabled but VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, or VAPID_SUBJECT is missing",
    );
  }

  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
  pushReady = true;
  return true;
};

const userJobPrefix = (userId: number | string) => `prayer_${userId}_`;

// Cancel every scheduled prayer job belonging to one user (used before
// rescheduling and when the user unsubscribes).
export const cancelPrayersForUser = (userId: number | string) => {
  const prefix = userJobPrefix(userId);
  let cancelled = 0;
  for (const jobName of Object.keys(schedule.scheduledJobs)) {
    if (jobName.startsWith(prefix)) {
      schedule.scheduledJobs[jobName].cancel();
      cancelled += 1;
    }
  }
  if (cancelled > 0) {
    logger.info(`Cancelled ${cancelled} scheduled prayer jobs`, { userId });
  }
};

// Send a push notification
export const sendPrayerNotification = async (
  subscription: any,
  prayerName: string,
  userId?: number,
) => {
  if (!pushReady) return;

  const payload = JSON.stringify({
    title: `حان وقت صلاة ${prayerName}`,
    body: "لا تنس ذكر الله وإقامة الصلاة في وقتها.",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
  });

  try {
    await webpush.sendNotification(subscription, payload);
    logger.info(`Prayer notification (${prayerName}) sent successfully`, { userId });
  } catch (error: any) {
    logger.error("Failed to send push notification", { error, userId });
    // 404/410 mean the browser subscription no longer exists — drop it so we
    // stop scheduling sends into the void every day.
    const statusCode = error?.statusCode;
    if (userId && (statusCode === 404 || statusCode === 410)) {
      cancelPrayersForUser(userId);
      await User.update(
        { pushSubscription: null },
        { where: { id: userId } },
      ).catch((cleanupError) =>
        logger.error("Failed to clear expired push subscription", {
          error: cleanupError,
          userId,
        }),
      );
    }
  }
};

// Calculate and schedule prayers for a specific user for the given date.
// Also called right after a user subscribes, so their notifications start
// today instead of after the next midnight run/restart.
export const schedulePrayersForUser = (user: User, date: Date) => {
  if (!pushReady) return;
  if (!user.pushSubscription || !user.location) return;

  const loc = user.location as any;
  if (!loc.latitude || !loc.longitude) return;

  // Re-subscribing must not double-schedule
  cancelPrayersForUser(user.id);

  const coordinates = new Coordinates(loc.latitude, loc.longitude);
  const params = CalculationMethod.MuslimWorldLeague();

  const prayerTimes = new PrayerTimes(coordinates, date, params);

  const prayers = [
    { name: "الفجر", time: prayerTimes.fajr },
    { name: "الظهر", time: prayerTimes.dhuhr },
    { name: "العصر", time: prayerTimes.asr },
    { name: "المغرب", time: prayerTimes.maghrib },
    { name: "العشاء", time: prayerTimes.isha },
  ];

  const now = new Date();
  let scheduled = 0;

  prayers.forEach((prayer) => {
    // Only schedule if the prayer time is in the future
    if (prayer.time > now) {
      schedule.scheduleJob(
        `${userJobPrefix(user.id)}${prayer.name}_${prayer.time.getTime()}`,
        prayer.time,
        () => {
          sendPrayerNotification(user.pushSubscription, prayer.name, user.id);
        },
      );
      scheduled += 1;
    }
  });

  logger.info(`Scheduled ${scheduled} prayer notifications`, {
    userId: user.id,
    date: date.toISOString().split("T")[0],
  });
};

const scheduleDailyPrayers = async () => {
  try {
    // Find users who have subscriptions and location
    const users = await User.findAll();
    const activeUsers = users.filter((u) => u.pushSubscription && u.location);

    logger.info(`Found ${activeUsers.length} users with push subscriptions`);

    const today = new Date();

    activeUsers.forEach((user) => {
      schedulePrayersForUser(user, today);
    });
  } catch (error) {
    logger.error("Error scheduling daily prayers", { error });
  }
};

// Main function to run the daily scheduler
export const initPrayerTimeScheduler = () => {
  if (!initWebPush()) return;

  // Run immediately on startup for today
  scheduleDailyPrayers();

  // Schedule to run every day at 00:01 AM
  schedule.scheduleJob("1 0 * * *", () => {
    logger.info("Running daily prayer scheduler...");
    scheduleDailyPrayers();
  });
};

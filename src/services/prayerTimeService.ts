import schedule from "node-schedule";
import webpush from "web-push";
import { Coordinates, CalculationMethod, PrayerTimes } from "adhan";
import User from "../models/user.model";
import logger from "../config/logger";
import dotenv from "dotenv";

if (process.env.NODE_ENV !== "production") {
  dotenv.config();
}

// Set up web-push VAPID details
const initWebPush = () => {
  const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
  const vapidSubject = process.env.VAPID_SUBJECT || "mailto:admin@example.com";

  if (!vapidPublicKey || !vapidPrivateKey) {
    logger.warn("VAPID keys are missing. Push notifications will not work.");
    return false;
  }

  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
  return true;
};

// Send a push notification
export const sendPrayerNotification = async (subscription: any, prayerName: string) => {
  const payload = JSON.stringify({
    title: `حان وقت صلاة ${prayerName}`,
    body: "لا تنس ذكر الله وإقامة الصلاة في وقتها.",
    icon: "/assets/snabel-logo.png", // Ensure you have this or similar in frontend
  });

  try {
    await webpush.sendNotification(subscription, payload);
    logger.info(`Prayer notification (${prayerName}) sent successfully`);
  } catch (error) {
    logger.error("Failed to send push notification", { error });
  }
};

// Calculate and schedule prayers for a specific user for the given date
const schedulePrayersForUser = (user: User, date: Date) => {
  if (!user.pushSubscription || !user.location) return;

  const loc = user.location as any;
  if (!loc.latitude || !loc.longitude) return;

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

  prayers.forEach((prayer) => {
    // Only schedule if the prayer time is in the future
    if (prayer.time > now) {
      schedule.scheduleJob(`prayer_${user.id}_${prayer.name}_${prayer.time.getTime()}`, prayer.time, () => {
        sendPrayerNotification(user.pushSubscription, prayer.name);
      });
    }
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

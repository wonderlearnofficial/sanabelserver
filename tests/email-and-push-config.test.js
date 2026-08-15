const test = require("node:test");
const assert = require("node:assert/strict");

const {
  EmailDeliveryError,
  sendEmail,
} = require("../dist/helpers/sendEmail");
const { initWebPush } = require("../dist/services/prayerTimeService");

const withEnvironment = async (changes, callback) => {
  const previous = {};
  for (const [key, value] of Object.entries(changes)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  try {
    return await callback();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};

test("email delivery fails safely when no provider is configured", async () => {
  await withEnvironment({
    RESEND_API_KEY: undefined,
    MAIL_HOST: undefined,
    MAIL_USERNAME: undefined,
    MAIL_PASSWORD: undefined,
    EMAIL_USER: undefined,
  }, async () => {
    await assert.rejects(
      sendEmail({
        to: "person@example.com",
        subject: "Test",
        text: "Test",
      }),
      (error) => error instanceof EmailDeliveryError && error.statusCode === 503,
    );
  });
});

test("push notifications can be deliberately disabled", async () => {
  await withEnvironment({ PUSH_NOTIFICATIONS_ENABLED: "false" }, async () => {
    assert.equal(initWebPush(), false);
  });
});

test("enabled push notifications require complete VAPID configuration", async () => {
  await withEnvironment({
    PUSH_NOTIFICATIONS_ENABLED: "true",
    VAPID_PUBLIC_KEY: undefined,
    VAPID_PRIVATE_KEY: undefined,
    VAPID_SUBJECT: undefined,
  }, async () => {
    assert.throws(initWebPush, /VAPID_PUBLIC_KEY/);
  });
});

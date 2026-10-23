const test = require("node:test");
const assert = require("node:assert/strict");

const {
  EmailDeliveryError,
  sendEmail,
} = require("../dist/helpers/sendEmail");
const EmailEvent = require("../dist/models/email-event.model").default;
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

test("Resend acceptance is recorded as accepted, never delivered", async () => {
  const originalCreate = EmailEvent.create;
  const originalFetch = global.fetch;
  const events = [];
  EmailEvent.create = async (event) => { events.push(event); return event; };
  global.fetch = async () => new Response(JSON.stringify({ id: "provider-message-1" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

  try {
    await withEnvironment({
      RESEND_API_KEY: "test-key",
      EMAIL_USER: "sender@example.invalid",
    }, async () => {
      await sendEmail({
        to: "recipient@example.invalid",
        userId: 42,
        purpose: "OTP",
        subject: "Test",
        text: "Sensitive body is deliberately not persisted",
      });
    });
  } finally {
    EmailEvent.create = originalCreate;
    global.fetch = originalFetch;
  }

  assert.equal(events.length, 1);
  assert.equal(events[0].status, "send_accepted");
  assert.equal(events[0].purpose, "OTP");
  assert.equal(events[0].providerMessageId, "provider-message-1");
  assert.equal(events[0].userId, 42);
  assert.equal(events[0].to, undefined);
  assert.equal(events[0].subject, undefined);
  assert.equal(events[0].text, undefined);
  assert.match(events[0].recipientHash, /^[a-f0-9]{64}$/);
});

test("provider rejection records a normalized failure and still rejects the send", async () => {
  const originalCreate = EmailEvent.create;
  const originalFetch = global.fetch;
  const events = [];
  EmailEvent.create = async (event) => { events.push(event); return event; };
  global.fetch = async () => new Response("rejected", { status: 422 });

  try {
    await withEnvironment({
      RESEND_API_KEY: "test-key",
      EMAIL_USER: "sender@example.invalid",
    }, async () => {
      await assert.rejects(
        sendEmail({
          to: "recipient@example.invalid",
          purpose: "PASSWORD_RESET",
          subject: "Test",
          text: "Test",
        }),
        (error) => error instanceof EmailDeliveryError && error.provider === "resend",
      );
    });
  } finally {
    EmailEvent.create = originalCreate;
    global.fetch = originalFetch;
  }

  assert.equal(events.length, 1);
  assert.equal(events[0].status, "send_failed");
  assert.equal(events[0].failureCode, "HTTP_422");
  assert.equal(events[0].failureCategory, "provider_rejected");
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

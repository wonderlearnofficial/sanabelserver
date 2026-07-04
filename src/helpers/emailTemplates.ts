/**
 * Returns a fully self-contained, responsive HTML email for OTP delivery.
 * Logos are embedded as base64 data URIs (using small, pre-resized copies —
 * see assets/splash-email.png / wonderlearn-email.png) rather than linked by
 * public URL, so they render even when BASE_URL isn't reachable (e.g. the
 * server is down or the URL changed) and stay well under Gmail's 102 KB clip
 * limit despite being inlined.
 * Compatible with Outlook, Gmail, Apple Mail, and all major clients.
 */

import fs from "fs";
import path from "path";

function loadLogoDataUri(filename: string): string {
  const filePath = path.resolve(__dirname, "../../assets", filename);
  const buffer = fs.readFileSync(filePath);
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

// Computed once at module load — both logos are tiny (see assets/*-email.png)
// so this is cheap and avoids re-reading/re-encoding on every email sent.
const sanabelLogoDataUri = loadLogoDataUri("splash-email.png");
const wonderlearnLogoDataUri = loadLogoDataUri("wonderlearn-email.png");

export function buildOtpEmail(otp: string): string {
  const digits = otp.split(""); // e.g. ['1','2','3','4']

  const sanabelUri = sanabelLogoDataUri;
  const wonderlearnUri = wonderlearnLogoDataUri;

  const digitBoxes = digits
    .map(
      (d) => `
        <td style="
          width: 60px;
          height: 72px;
          text-align: center;
          vertical-align: middle;
          font-size: 38px;
          font-weight: 800;
          color: #1a3a2e;
          background: #ffffff;
          border: 2px solid #d4e8d8;
          border-radius: 14px;
          padding: 0;
          line-height: 72px;
          box-shadow: 0 2px 8px rgba(45,100,70,0.10);
        ">${d}</td>
        <td style="width: 12px;"></td>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Your Verification Code – Sanabel Al-Ihsan</title>
</head>
<body style="margin:0;padding:0;background:#eef4f0;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">

  <!-- Outer wrapper -->
  <table width="100%" cellpadding="0" cellspacing="0" border="0"
         style="background:#eef4f0;padding:48px 16px;">
    <tr>
      <td align="center">

        <!-- Card -->
        <table width="580" cellpadding="0" cellspacing="0" border="0"
               style="max-width:580px;width:100%;background:#ffffff;
                      border-radius:24px;overflow:hidden;
                      box-shadow:0 12px 48px rgba(0,0,0,0.12);">

          <!-- ══ HEADER ══ -->
          <tr>
            <td style="
              background: linear-gradient(145deg, #0f2e1e 0%, #1a5c38 45%, #2d8c56 100%);
              padding: 36px 40px 28px;
              text-align: center;
            ">
              <!-- Sanabel logo -->
              ${sanabelUri ? `<img src="${sanabelUri}" alt="Sanabel Al-Ihsan"
                   width="90" height="90"
                   style="display:inline-block;border-radius:50%;
                          border:3px solid rgba(255,255,255,0.25);
                          box-shadow:0 4px 16px rgba(0,0,0,0.25);
                          margin-bottom:16px;" />` : `<div style="font-size:52px;margin-bottom:16px;">🌿</div>`}

              <h1 style="
                margin: 0 0 4px;
                font-size: 24px;
                font-weight: 800;
                color: #ffffff;
                letter-spacing: 0.5px;
              ">Sanabel Al-Ihsan</h1>
              <p style="
                margin: 0;
                font-size: 14px;
                color: rgba(255,255,255,0.65);
                letter-spacing: 3px;
                font-weight: 400;
              ">سنابل الإحسان</p>
            </td>
          </tr>

          <!-- ══ HERO STRIP ══ -->
          <tr>
            <td style="
              background: linear-gradient(90deg, #1a5c38, #2d8c56);
              padding: 12px 40px;
              text-align: center;
            ">
              <p style="
                margin:0;
                font-size:12px;
                color:rgba(255,255,255,0.80);
                letter-spacing:2px;
                text-transform:uppercase;
                font-weight:600;
              ">🔐 Email Verification</p>
            </td>
          </tr>

          <!-- ══ BODY ══ -->
          <tr>
            <td style="padding: 44px 40px 36px;">

              <!-- Greeting -->
              <p style="
                margin: 0 0 10px;
                font-size: 24px;
                font-weight: 700;
                color: #0f2e1e;
              ">Hello there! 👋</p>

              <p style="
                margin: 0 0 32px;
                font-size: 15px;
                line-height: 1.7;
                color: #4a5568;
              ">
                We received a request to verify your email address for your
                <strong style="color:#1a5c38;">Sanabel Al-Ihsan</strong> account.
                Use the verification code below to continue. This code is valid for
                <strong style="color:#1a5c38;">5 minutes</strong>.
              </p>

              <!-- ── OTP label ── -->
              <p style="
                margin: 0 0 14px;
                font-size: 11px;
                font-weight: 700;
                color: #9aa5b1;
                letter-spacing: 3px;
                text-transform: uppercase;
                text-align: center;
              ">Your verification code</p>

              <!-- ── OTP digit boxes ── -->
              <table cellpadding="0" cellspacing="0" border="0"
                     style="margin: 0 auto 16px;">
                <tr>${digitBoxes}</tr>
              </table>

              <!-- Countdown hint -->
              <p style="
                margin: 0 0 36px;
                font-size: 12px;
                color: #b0bec5;
                text-align: center;
              ">Expires in 5 minutes · Do not share this code</p>

              <!-- ── Divider ── -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0"
                     style="margin:0 0 28px;">
                <tr>
                  <td style="height:1px;background:linear-gradient(90deg,transparent,#d1fae5,transparent);"></td>
                </tr>
              </table>

              <!-- ── Security notice ── -->
              <table cellpadding="0" cellspacing="0" border="0" width="100%"
                     style="background:#f0fdf4;border-left:4px solid #2d8c56;
                            border-radius:0 12px 12px 0;padding:18px 20px;">
                <tr>
                  <td style="font-size:13px;color:#276749;line-height:1.7;">
                    <strong>🔒 Security Reminder</strong><br/>
                    We will <em>never</em> call or email you to ask for this code.
                    If you didn't request this, you can safely ignore this message —
                    your account remains secure.
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- ══ FOOTER ══ -->
          <tr>
            <td style="
              background: #f7faf8;
              border-top: 1px solid #e2ece7;
              padding: 28px 40px;
              text-align: center;
            ">
              <!-- WonderLearn logo -->
              ${wonderlearnUri ? `<img src="${wonderlearnUri}" alt="WonderLearn – Gamified Solutions"
                   height="36"
                   style="display:inline-block;margin-bottom:12px;opacity:0.85;" />` : `<p style="margin:0 0 10px;font-size:13px;font-weight:700;color:#2d8c56;">WonderLearn</p>`}

              <p style="margin:0 0 4px;font-size:11px;color:#9aa5b1;">
                This email was sent by Sanabel Al-Ihsan, powered by WonderLearn.
              </p>
              <p style="margin:0;font-size:11px;color:#c5cfd6;">
                © ${new Date().getFullYear()} WonderLearn · Gamified Solutions · All rights reserved.
              </p>
            </td>
          </tr>

        </table>
        <!-- /Card -->

      </td>
    </tr>
  </table>

</body>
</html>`;
}

/**
 * Account-created email (bulk Excel import onboarding) — same header/footer
 * chrome as the OTP email so the logo actually renders, instead of the
 * previous plain-text-only message.
 */
export function buildAccountCreatedEmail(params: {
  firstName: string;
  email: string;
  password: string;
  roleLabel: string; // e.g. "student" or "teacher"
}): string {
  const { firstName, email, password, roleLabel } = params;
  const sanabelUri = sanabelLogoDataUri;
  const wonderlearnUri = wonderlearnLogoDataUri;

  return `<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Your Account – Sanabel Al-Ihsan</title>
</head>
<body style="margin:0;padding:0;background:#eef4f0;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">

  <table width="100%" cellpadding="0" cellspacing="0" border="0"
         style="background:#eef4f0;padding:48px 16px;">
    <tr>
      <td align="center">

        <table width="580" cellpadding="0" cellspacing="0" border="0"
               style="max-width:580px;width:100%;background:#ffffff;
                      border-radius:24px;overflow:hidden;
                      box-shadow:0 12px 48px rgba(0,0,0,0.12);">

          <!-- ══ HEADER ══ -->
          <tr>
            <td style="
              background: linear-gradient(145deg, #0f2e1e 0%, #1a5c38 45%, #2d8c56 100%);
              padding: 36px 40px 28px;
              text-align: center;
            ">
              ${sanabelUri ? `<img src="${sanabelUri}" alt="Sanabel Al-Ihsan"
                   width="90" height="90"
                   style="display:inline-block;border-radius:50%;
                          border:3px solid rgba(255,255,255,0.25);
                          box-shadow:0 4px 16px rgba(0,0,0,0.25);
                          margin-bottom:16px;" />` : `<div style="font-size:52px;margin-bottom:16px;">🌿</div>`}

              <h1 style="
                margin: 0 0 4px;
                font-size: 24px;
                font-weight: 800;
                color: #ffffff;
                letter-spacing: 0.5px;
              ">Sanabel Al-Ihsan</h1>
              <p style="
                margin: 0;
                font-size: 14px;
                color: rgba(255,255,255,0.65);
                letter-spacing: 3px;
                font-weight: 400;
              ">سنابل الإحسان</p>
            </td>
          </tr>

          <!-- ══ HERO STRIP ══ -->
          <tr>
            <td style="
              background: linear-gradient(90deg, #1a5c38, #2d8c56);
              padding: 12px 40px;
              text-align: center;
            ">
              <p style="
                margin:0;
                font-size:12px;
                color:rgba(255,255,255,0.80);
                letter-spacing:2px;
                text-transform:uppercase;
                font-weight:600;
              ">🎉 Your Account Is Ready</p>
            </td>
          </tr>

          <!-- ══ BODY ══ -->
          <tr>
            <td style="padding: 44px 40px 36px;">

              <p style="
                margin: 0 0 10px;
                font-size: 24px;
                font-weight: 700;
                color: #0f2e1e;
              ">Welcome, ${firstName}! 👋</p>

              <p style="
                margin: 0 0 32px;
                font-size: 15px;
                line-height: 1.7;
                color: #4a5568;
              ">
                Your ${roleLabel} account for <strong style="color:#1a5c38;">Sanabel Al-Ihsan</strong>
                has been created. Use the credentials below to log in.
              </p>

              <table width="100%" cellpadding="0" cellspacing="0" border="0"
                     style="background:#f0fdf4;border-radius:16px;padding:4px;margin-bottom:20px;">
                <tr>
                  <td style="padding:20px 24px;">
                    <p style="margin:0 0 4px;font-size:11px;font-weight:700;color:#9aa5b1;letter-spacing:2px;text-transform:uppercase;">Email</p>
                    <p style="margin:0 0 16px;font-size:16px;font-weight:600;color:#0f2e1e;word-break:break-all;">${email}</p>
                    <p style="margin:0 0 4px;font-size:11px;font-weight:700;color:#9aa5b1;letter-spacing:2px;text-transform:uppercase;">Password</p>
                    <p style="margin:0;font-size:20px;font-weight:800;color:#1a5c38;letter-spacing:1px;">${password}</p>
                  </td>
                </tr>
              </table>

              <table cellpadding="0" cellspacing="0" border="0" width="100%"
                     style="background:#f0fdf4;border-left:4px solid #2d8c56;
                            border-radius:0 12px 12px 0;padding:18px 20px;">
                <tr>
                  <td style="font-size:13px;color:#276749;line-height:1.7;">
                    <strong>🔒 Please change your password</strong><br/>
                    Log in and update your password from your profile whenever you like.
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- ══ FOOTER ══ -->
          <tr>
            <td style="
              background: #f7faf8;
              border-top: 1px solid #e2ece7;
              padding: 28px 40px;
              text-align: center;
            ">
              ${wonderlearnUri ? `<img src="${wonderlearnUri}" alt="WonderLearn – Gamified Solutions"
                   height="36"
                   style="display:inline-block;margin-bottom:12px;opacity:0.85;" />` : `<p style="margin:0 0 10px;font-size:13px;font-weight:700;color:#2d8c56;">WonderLearn</p>`}

              <p style="margin:0 0 4px;font-size:11px;color:#9aa5b1;">
                This email was sent by Sanabel Al-Ihsan, powered by WonderLearn.
              </p>
              <p style="margin:0;font-size:11px;color:#c5cfd6;">
                © ${new Date().getFullYear()} WonderLearn · Gamified Solutions · All rights reserved.
              </p>
            </td>
          </tr>

        </table>

      </td>
    </tr>
  </table>

</body>
</html>`;
}

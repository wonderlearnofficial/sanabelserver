import { randomInt } from "crypto";

function generatePassword(length = 12) {
  // Define character pools
  const lowercase = "abcdefghijklmnopqrstuvwxyz";
  const uppercase = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const numbers = "0123456789";
  const symbols = "@#$";

  // Combine all characters
  const allCharacters = lowercase + uppercase + numbers + symbols;

  // Ensure password contains at least one of each type
  const getRandomChar = (str: any) =>
    str[Math.floor(Math.random() * str.length)];

  let password = [
    getRandomChar(lowercase),
    getRandomChar(uppercase),
    getRandomChar(numbers),
    getRandomChar(symbols),
  ];

  // Fill the rest of the password with random characters
  for (let i = password.length; i < length; i++) {
    password.push(getRandomChar(allCharacters));
  }

  // Shuffle the password to randomize order
  password = password.sort(() => Math.random() - 0.5);

  return password.join("");
}
// Bulk-imported accounts (students especially) need something short enough
// to type on first login rather than a 12-char mixed password — but each
// one must still be random and distinct, or every imported user shares one
// known password and can log into anyone else's account.
function generateSixDigitPassword(): string {
  return String(randomInt(100000, 1000000));
}

// Bulk-import credentials (students, teachers, parents). Cryptographically
// random, 10 characters from an alphabet without look-alikes (no 0/o, 1/l/i),
// always mixing letters and digits so it is easy to read out and type on a
// phone yet far harder to guess than a 6-digit number.
const IMPORT_LETTERS = "abcdefghjkmnpqrstuvwxyz";
const IMPORT_DIGITS = "23456789";
function generateImportPassword(length = 10): string {
  const all = IMPORT_LETTERS + IMPORT_DIGITS;
  const chars = [
    IMPORT_LETTERS[randomInt(IMPORT_LETTERS.length)],
    IMPORT_DIGITS[randomInt(IMPORT_DIGITS.length)],
  ];
  while (chars.length < Math.max(10, length)) chars.push(all[randomInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

export { generatePassword, generateSixDigitPassword, generateImportPassword };

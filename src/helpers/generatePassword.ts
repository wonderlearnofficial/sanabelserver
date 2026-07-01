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
export { generatePassword };

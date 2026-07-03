import Student from "../models/student.model";

async function generateUniqueConnectCode(): Promise<string> {
    let connectCode:string = ""; 
    let isUnique = false;
  
    while (!isUnique) {
      connectCode = Math.floor(10000 + Math.random() * 90000).toString(); // Generate 5-digit code
  
      // Check if the code already exists
      const existingStudent = await Student.findOne({ where: { connectCode } });
      if (!existingStudent) {
        isUnique = true; // Exit loop if unique
      }
    }
  
    return connectCode;
  }
  export default generateUniqueConnectCode;
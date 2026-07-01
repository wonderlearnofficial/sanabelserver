import Student from "../models/student.model";

async function generateUniqueConnectCode(): Promise<string> {
    let connectCode:string = ""; 
    let isUnique = false;
  
    while (!isUnique) {
      connectCode = Math.random().toString(36).slice(-10).toUpperCase(); // Generate 10-character code
  
      // Check if the code already exists
      const existingStudent = await Student.findOne({ where: { connectCode } });
      if (!existingStudent) {
        isUnique = true; // Exit loop if unique
      }
    }
  
    return connectCode;
  }
  export default generateUniqueConnectCode;
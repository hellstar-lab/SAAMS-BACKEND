import { db } from './config/firebase.js';

async function verifyMismatch() {
  const studentQuery = await db.collection('students').where('name', '==', 'Ac').get();
  const student = studentQuery.docs[0].data();
  
  const classQuery = await db.collection('classes').where('subjectName', '==', 'Dispute Test 8168').get();
  const classDoc = classQuery.docs[0].data();
  
  console.log("=== DEPARTMENT ID COMPARISON ===");
  console.log(`Student 'Ac' Dept ID : "${student.departmentId}"`);
  console.log(`Class 'DT699' Dept ID: "${classDoc.departmentId}"`);
  console.log(`Match? ${student.departmentId === classDoc.departmentId}`);
  
  if (student.departmentId !== classDoc.departmentId) {
      console.log("\n⚠️ The student and the class are in different departments!");
      console.log("Student Dept contains 'iOH' (Letter O)");
      console.log("Class Dept contains   'i0H' (Number zero)");
      console.log("\nThe student search only pulls students from the same department as the class/teacher.");
  }
  
  process.exit(0);
}

verifyMismatch().catch(console.error);

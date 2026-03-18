import { db } from './config/firebase.js';

async function verifyClassAddSearch() {
  console.log("=== CHECKING STUDENT ===");
  const studentQuery = await db.collection('students')
    .where('name', '==', 'Ac')
    .get();
    
  if (studentQuery.empty) {
      console.log("Could not find student 'Ac'");
      process.exit(1);
  }
  
  const student = studentQuery.docs[0].data();
  const studentDeptId = student.departmentId;
  console.log(`Student 'Ac' found!`);
  console.log(`- ID: ${student.studentId}`);
  console.log(`- ROLL: ${student.rollNumber}`);
  console.log(`- DEPT: "${studentDeptId}"`);
  console.log(`- SEM: ${student.semester} | SEC: ${student.section}`);
  console.log(`- ACTIVE: ${student.isActive}`);
  
  console.log("\n=== CHECKING CLASS ===");
  const classQuery = await db.collection('classes')
    .where('subjectName', '==', 'test 8168')
    .get();
    
  if (classQuery.empty) {
      console.log("Could not find class 'test 8168' by subjectName. Checking subjectCode instead.");
      const classQuery2 = await db.collection('classes')
        .where('subjectCode', '==', 'TEST8168')
        .get();
      if (classQuery2.empty) {
          console.log("Could not find class 'test 8168' at all.");
          process.exit(1);
      }
      var classDoc = classQuery2.docs[0].data();
  } else {
      var classDoc = classQuery.docs[0].data();
  }

  const classDeptId = classDoc.departmentId;
  console.log(`Class found!`);
  console.log(`- SUBJECT: ${classDoc.subjectName} (${classDoc.subjectCode})`);
  console.log(`- DEPT: "${classDeptId}"`);
  console.log(`- SEM: ${classDoc.semester} | SEC: ${classDoc.section}`);
  
  console.log("\n=== COMPARING ===");
  if (studentDeptId !== classDeptId) {
      console.log(`❌ MISMATCH! The student belongs to department "${studentDeptId}" while the class belongs to department "${classDeptId}".`);
      console.log(`The student search (driven by HOD/teacher department) only pulls students from the same department.`);
  } else {
      console.log(`✅ MATCH! They belong to the same department.`);
  }
  
  if (classDoc.students && classDoc.students.includes(student.studentId)) {
      console.log(`ℹ️ Student is ALREADY ENROLLED in this class.`);
  }
  
  process.exit(0);
}

verifyClassAddSearch().catch(console.error);

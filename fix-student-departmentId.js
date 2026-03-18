import { db } from './config/firebase.js';

async function fixDepartmentId() {
  console.log("=== CHECKING FOR INVALID DEPARTMENT IDs ===");
  const students = await db.collection('students')
    .orderBy('createdAt', 'desc')
    .limit(50)
    .get();
    
  let fixedCount = 0;
  
  for (const doc of students.docs) {
      const s = doc.data();
      const rawDeptId = s.departmentId;
      
      if (rawDeptId && typeof rawDeptId === 'string' && rawDeptId !== rawDeptId.trim()) {
          const cleanDeptId = rawDeptId.trim();
          console.log(`\nFound issue with student: ${s.name} (${s.rollNumber})`);
          console.log(`Original departmentId: "${rawDeptId}"`);
          console.log(`Cleaned departmentId : "${cleanDeptId}"`);
          
          await db.collection('students').doc(doc.id).update({
              departmentId: cleanDeptId
          });
          console.log("✅ Fixed in database.");
          fixedCount++;
      }
  }

  console.log(`\nScan complete. Fixed ${fixedCount} student records.`);
  process.exit(0);
}

fixDepartmentId().catch(console.error);

import { db } from './config/firebase.js';

async function findClasses() {
  console.log("=== RECENT CLASSES ===");
  const classQuery = await db.collection('classes')
    .orderBy('createdAt', 'desc')
    .limit(10)
    .get();
    
  classQuery.forEach(doc => {
      const c = doc.data();
      console.log(`- Subject: "${c.subjectName}" Code: "${c.subjectCode}" Dept: "${c.departmentId}" Sem: ${c.semester} Sec: ${c.section}`);
  });
  
  process.exit(0);
}

findClasses().catch(console.error);

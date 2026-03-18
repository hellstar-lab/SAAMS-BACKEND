import { db } from './config/firebase.js';

async function testSearch() {
  // Let's first find the newest student to see their exact data structure
  const recentStudents = await db.collection('students')
    .orderBy('createdAt', 'desc')
    .limit(3)
    .get();
    
  console.log("=== MOST RECENTLY CREATED STUDENTS ===");
  recentStudents.forEach(doc => {
      const s = doc.data();
      console.log(`- ${s.name} (${s.rollNumber})`);
      console.log(`  departmentId: "${s.departmentId}"`);
      console.log(`  isActive: ${s.isActive}`);
      console.log(`  semester: ${s.semester}`);
      console.log(`  section: "${s.section}"`);
      console.log(`  createdAt: ${s.createdAt?.toDate()}`);
      console.log('---');
  });

  if (recentStudents.empty) {
      console.log("No students found in DB.");
      process.exit(0);
  }

  // Take the most recently created student for our test
  const targetStudent = recentStudents.docs[0].data();
  const deptId = targetStudent.departmentId;
  const searchQuery = targetStudent.name.substring(0, 3).toLowerCase(); // First 3 letters of their name
  
  console.log(`\n=== RUNNING SEARCH SIMULATION ===`);
  console.log(`Targeting Department: "${deptId}"`);
  console.log(`Search Query: "${searchQuery}"`);

  // Simulate the exact query from hodController.js: getDepartmentStudents
  let query = db.collection('students').where('departmentId', '==', deptId);
  // query = query.orderBy('name', 'asc'); // Removing to see if index on name is the issue
  
  try {
      const snap = await query.get();
      console.log(`\nBase Query found ${snap.docs.length} total students in department ${deptId}`);
      
      let students = snap.docs.map(doc => doc.data());
      
      if (searchQuery) {
          const queryLower = searchQuery.toLowerCase();
          students = students.filter(s =>
              (s.name && s.name.toLowerCase().includes(queryLower)) ||
              (s.rollNumber && s.rollNumber.toLowerCase().includes(queryLower))
          );
      }
      
      console.log(`\nFound ${students.length} students after applying search filter ("${searchQuery}")`);
      students.forEach(s => console.log(`- ${s.name} (${s.rollNumber})`));
      
      // Check if our target student is in the results
      const foundTarget = students.find(s => s.studentId === targetStudent.studentId);
      if (foundTarget) {
          console.log(`\n✅ SUCCESS: The newly created student WAS found in the search results.`);
      } else {
          console.log(`\n❌ ERROR: The newly created student WAS NOT found in the results!`);
      }
      
  } catch (error) {
      console.error("Query failed:", error);
  }
  
  process.exit(0);
}

testSearch().catch(console.error);

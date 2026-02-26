import { db } from './config/firebase.js';
async function test() {
    const classId = "7OoyTH9BH2LKQDNx5WWU";
    const classDoc = await db.collection('classes').doc(classId).get();
    console.log("Class TeacherId:", classDoc.data().teacherId);
    
    // Check if Teacher exists
    const teacherDoc = await db.collection('teachers').doc(classDoc.data().teacherId).get();
    console.log("Teacher Doc Exists:", teacherDoc.exists);
    if (teacherDoc.exists) console.log("Teacher Role:", teacherDoc.data().role);
    process.exit(0);
}
test();

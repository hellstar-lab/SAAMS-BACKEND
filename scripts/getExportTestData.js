import { auth, db } from '../config/firebase.js';

const fetchToken = async (uid) => {
    const customToken = await auth.createCustomToken(uid);
    const API_KEY = process.env.FIREBASE_API_KEY || ''; // Usually needed, let's see if we can do it without or just print the custom token 
    // Actually, we can use the identitytoolkit trick if we have the web API key, but we might not have it in process.env.
    // Let's just output the document IDs the user needs, and tell them how to get the tokens (or we can use seedDemo credentials).
}

const generateTestDetails = async () => {
    try {
        console.log('--- EXPORT ENDPOINTS TEST DATA ---');
        console.log('Building test data from Database...');

        // 1. Get any Class
        const classesSnap = await db.collection('classes').limit(1).get();
        const classData = classesSnap.docs[0].data();
        const classId = classesSnap.docs[0].id;

        // 2. Get the Teacher of that Class
        const teacherId = classData.teacherId;
        const teacherDoc = await db.collection('teachers').doc(teacherId).get();
        const teacher = teacherDoc.data();

        // 3. Get a Student from that class
        const studentId = classData.students[0];
        const studentDoc = await db.collection('students').doc(studentId).get();
        const student = studentDoc.data();

        // 4. Get the Department and HOD
        const deptId = classData.departmentId;
        const deptDoc = await db.collection('departments').doc(deptId).get();
        const dept = deptDoc.data();
        const hodId = dept.hodId;
        const hodDoc = await db.collection('teachers').doc(hodId).get();
        const hod = hodDoc.data();

        // 5. Generate Custom Tokens
        const teacherCustomToken = await auth.createCustomToken(teacherId);
        const studentCustomToken = await auth.createCustomToken(studentId);
        const hodCustomToken = await auth.createCustomToken(hodId);

        console.log('\n=========================================');
        console.log('✅ TEST 1: CLASS EXCEL EXPORT (Teacher)');
        console.log('=========================================');
        console.log(`Endpoint:  GET http://localhost:5000/api/attendance/export/class/${classId}`);
        console.log(`Teacher Email: ${teacher.email}`);
        console.log(`Password:      demo123`);
        console.log(`\n(Login via POST /api/auth/login or use the Teacher App to get the Bearer token)`);

        console.log('\n=========================================');
        console.log('✅ TEST 2: STUDENT CERTIFICATE PDF (Student)');
        console.log('=========================================');
        console.log(`Endpoint:  GET http://localhost:5000/api/attendance/certificate/${studentId}`);
        console.log(`Student Email: ${student.email}`);
        console.log(`Password:      demo123`);
        console.log(`\n(Login via POST /api/auth/login or use the Student App to get the Bearer token)`);

        console.log('\n=========================================');
        console.log('✅ TEST 3: DEPARTMENT EXCEL EXPORT (HOD)');
        console.log('=========================================');
        console.log(`Endpoint:  GET http://localhost:5000/api/attendance/export/department/${deptId}`);
        console.log(`HOD Email:     ${hod.email}`);
        console.log(`Password:      demo123`);
        console.log(`\n(Login via POST /api/auth/login to get the Bearer token)`);
        
        console.log('\n=========================================');
        console.log('✅ EXTRA: CLASS PDF SESSION REPORT (Teacher)');
        console.log('=========================================');
        console.log(`Endpoint:  GET http://localhost:5000/api/attendance/export/class/${classId}/pdf`);
        console.log(`(Use the same Teacher token from Test 1)`);

        console.log('\n🎯 How to test:');
        console.log('1. Start your server (node index.js)');
        console.log('2. Send a POST request to http://localhost:5000/api/auth/login with { "email": "[EMAIL_ABOVE]", "password": "demo123" }');
        console.log('3. Copy the "token" from the response.');
        console.log('4. In Postman, go to the GET endpoint specified above.');
        console.log('5. Go to Headers -> Add "Authorization: Bearer <YOUR_COPIED_TOKEN>"');
        console.log('6. Click Send and Send and Download to save the file.');
        
        process.exit(0);

    } catch (error) {
        console.error('Error generating details:', error);
        process.exit(1);
    }
}

generateTestDetails();

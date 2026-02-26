import { auth, db } from '../config/firebase.js';
import dotenv from 'dotenv';
import https from 'https';

dotenv.config();

const API_KEY = process.env.FIREBASE_WEB_API_KEY;

if (!API_KEY) {
    console.error('Error: FIREBASE_WEB_API_KEY not found in .env');
    process.exit(1);
}

const exchangeCustomTokenForIdToken = (customToken) => {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify({
            token: customToken,
            returnSecureToken: true
        });

        const options = {
            hostname: 'identitytoolkit.googleapis.com',
            port: 443,
            path: `/v1/accounts:signInWithCustomToken?key=${API_KEY}`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': data.length
            }
        };

        const req = https.request(options, (res) => {
            let responseData = '';
            res.on('data', (chunk) => {
                responseData += chunk;
            });
            res.on('end', () => {
                const parsed = JSON.parse(responseData);
                if (parsed.idToken) {
                    resolve(parsed.idToken);
                } else {
                    reject(new Error(parsed.error ? parsed.error.message : 'Unknown error during token exchange'));
                }
            });
        });

        req.on('error', (e) => reject(e));
        req.write(data);
        req.end();
    });
};

const generateTokens = async () => {
    try {
        console.log('Fetching database references...\n');
        
        // 1. Get Class & Teacher
        const classesSnap = await db.collection('classes').limit(1).get();
        const classData = classesSnap.docs[0].data();
        const classId = classesSnap.docs[0].id;

        const teacherId = classData.teacherId;
        const teacherDoc = await db.collection('teachers').doc(teacherId).get();
        const teacher = teacherDoc.data();

        // 2. Get Student
        const studentId = classData.students[0];
        const studentDoc = await db.collection('students').doc(studentId).get();
        const student = studentDoc.data();

        // 3. Get Dept & HOD
        const deptId = classData.departmentId;
        const deptDoc = await db.collection('departments').doc(deptId).get();
        const dept = deptDoc.data();
        const hodId = dept.hodId;
        const hodDoc = await db.collection('teachers').doc(hodId).get();
        const hod = hodDoc.data();

        console.log('Generating Auth Tokens (this takes a few seconds)...');
        
        // Generate custom tokens
        const teacherCustomToken = await auth.createCustomToken(teacherId);
        const studentCustomToken = await auth.createCustomToken(studentId);
        const hodCustomToken = await auth.createCustomToken(hodId);

        // Exchange for real ID tokens
        const teacherToken = await exchangeCustomTokenForIdToken(teacherCustomToken);
        const studentToken = await exchangeCustomTokenForIdToken(studentCustomToken);
        const hodToken = await exchangeCustomTokenForIdToken(hodCustomToken);

        console.log('\n======================================================');
        console.log('✅ TEST 1: CLASS EXCEL EXPORT (Teacher)');
        console.log('======================================================');
        console.log(`GET http://localhost:5000/api/attendance/export/class/${classId}`);
        console.log(`\nAuthorization: Bearer ${teacherToken}`);

        console.log('\n======================================================');
        console.log('✅ TEST 2: STUDENT CERTIFICATE PDF (Student)');
        console.log('======================================================');
        console.log(`GET http://localhost:5000/api/attendance/certificate/${studentId}`);
        console.log(`\nAuthorization: Bearer ${studentToken}`);

        console.log('\n======================================================');
        console.log('✅ TEST 3: DEPARTMENT EXCEL EXPORT (HOD)');
        console.log('======================================================');
        console.log(`GET http://localhost:5000/api/attendance/export/department/${deptId}`);
        console.log(`\nAuthorization: Bearer ${hodToken}`);
        
        console.log('\n======================================================');
        console.log('✅ EXTRA: CLASS PDF SESSION REPORT (Teacher)');
        console.log('======================================================');
        console.log(`GET http://localhost:5000/api/attendance/export/class/${classId}/pdf`);
        console.log(`\nAuthorization: Bearer ${teacherToken}`);

        process.exit(0);

    } catch (error) {
        console.error('Error generating details:', error.message);
        process.exit(1);
    }
}

generateTokens();

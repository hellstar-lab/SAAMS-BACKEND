// Test for the updated addStudentsFromExcel endpoint
import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import https from 'https';
import http from 'http';

const serviceAccount = JSON.parse(readFileSync('./smart-attendance-app-2f038-firebase-adminsdk-fbsvc-79631dd66a.json', 'utf8'));
const firebaseApp = initializeApp({ credential: cert(serviceAccount) }, 'tester');
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);

const FIREBASE_WEB_API_KEY = 'AIzaSyDjOW32jxwkxNw6HKKWwJ5AGr2mywv9BQs';
const BASE_URL = 'http://localhost:3000/api';

function httpRequest(urlStr, opts = {}, body = null) {
    return new Promise((resolve, reject) => {
        const url = new URL(urlStr);
        const lib = url.protocol === 'https:' ? https : http;
        const req = lib.request({
            hostname: url.hostname,
            port: url.port,
            path: url.pathname + (url.search || ''),
            method: opts.method || 'GET',
            headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) }
        }, res => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => {
                try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
                catch { resolve({ status: res.statusCode, body: d }); }
            });
        });
        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

async function getIdToken(uid) {
    const custom = await auth.createCustomToken(uid, {});
    const res = await httpRequest(
        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${FIREBASE_WEB_API_KEY}`,
        { method: 'POST' },
        { token: custom, returnSecureToken: true }
    );
    if (!res.body.idToken) throw new Error('Token exchange failed: ' + JSON.stringify(res.body));
    return res.body.idToken;
}

function assert(label, condition, actual) {
    if (condition) {
        console.log(`  ✅ ${label}`);
    } else {
        console.log(`  ❌ ${label} — got: ${JSON.stringify(actual)}`);
    }
}

async function main() {
    console.log('═══════════════════════════════════════════════');
    console.log('  Add Students from Excel — Validation Tests');
    console.log('═══════════════════════════════════════════════\n');

    // Use known teacher and class from Firestore
    const teacherId = 'o27VLo88dCWj9UmLDCc6uYipN5w1'; // testteacher17@gmail.com
    const classId   = 'FLdBwnA3MkK2nK8lvZbS';           // Dispute Test class

    // Fetch two actual students from the database to test with
    const studentsSnap = await db.collection('students').limit(2).get();
    const s1 = studentsSnap.docs[0].data();
    const s2 = studentsSnap.docs[1].data();

    // Make sure s1 is NOT enrolled so we can add them, or remove them first
    const classRef = db.collection('classes').doc(classId);
    let classDoc = await classRef.get();
    let alreadyIn = classDoc.data().students || [];
    
    // Remove s1 if already in the class to test successful enrollment
    if (alreadyIn.includes(s1.studentId)) {
        await classRef.update({ students: FieldValue.arrayRemove(s1.studentId) });
        // wait a moment
        await new Promise(r => setTimeout(r, 1000));
        console.log(`Removed ${s1.rollNumber} from class to test enrollment.`);
    }
    // ensure s2 IS enrolled for alreadyEnrolled check
    if (!alreadyIn.includes(s2.studentId)) {
        await classRef.update({ students: FieldValue.arrayUnion(s2.studentId) });
        await new Promise(r => setTimeout(r, 1000));
    }

    const teacherToken = await getIdToken(teacherId);
    const auth_headers = { Authorization: `Bearer ${teacherToken}` };

    const excelData = [
        { rollNumber: s1.rollNumber, section: s1.section },            // Valid, should enroll
        { rollNumber: s2.rollNumber, section: s2.section },            // Valid, already enrolled
        { rollNumber: s1.rollNumber, section: 'WRONG_SECTION' },       // Duplicate in payload, will just use first encountered or we could test mismatch
        { rollNumber: 'FAKE_ROLL_NUM', section: 'A' }                  // Not found
    ];

    // To properly test sectionMismatch, let's add s1 again with a different section? 
    // Wait, we de-duplicate by rollNumber. So let's test a real student but pass the wrong section.
    // Let's find a third student.
    const s3Doc = await db.collection('students').offset(2).limit(1).get();
    const s3 = s3Doc.docs[0].data();
    excelData.push({ rollNumber: s3.rollNumber, section: s3.section === 'A' ? 'B' : 'A' }); // Mismatch section

    console.log(`\n📤 Sending POST /api/classes/${classId}/students/excel`);
    console.log(JSON.stringify({ students: excelData }, null, 2));

    const res = await httpRequest(
        `${BASE_URL}/classes/${classId}/students/excel`,
        { method: 'POST', headers: auth_headers },
        { students: excelData }
    );

    console.log(`\n📥 Response [${res.status}]:`);
    console.log(JSON.stringify(res.body, null, 2));

    // ─── Assertions ──────────────────────────────────────────────────
    console.log('\n─── Assertions ─────────────────────────────────');
    const data = res.body?.data;

    assert('Status 200', res.status === 200, res.status);
    assert('success: true', res.body?.success === true, res.body?.success);
    assert('data.enrolled is array', Array.isArray(data?.enrolled), data?.enrolled);
    assert('data.alreadyEnrolled is array', Array.isArray(data?.alreadyEnrolled), data?.alreadyEnrolled);
    assert('data.notFound is array', Array.isArray(data?.notFound), data?.notFound);
    assert('data.sectionMismatch is array', Array.isArray(data?.sectionMismatch), data?.sectionMismatch);
    
    assert('enrolled contains s1', data?.enrolled?.includes(s1.rollNumber), data?.enrolled);
    assert('alreadyEnrolled contains s2', data?.alreadyEnrolled?.includes(s2.rollNumber), data?.alreadyEnrolled);
    assert('notFound contains FAKE_ROLL_NUM', data?.notFound?.includes('FAKE_ROLL_NUM'), data?.notFound);
    
    const mismatchFound = data?.sectionMismatch?.some(s => s.startsWith(s3.rollNumber));
    assert('sectionMismatch contains s3', mismatchFound, data?.sectionMismatch);

    console.log('\n═══════════════════════════════════════════════');
    process.exit(0);
}

main().catch(err => { console.error('Uncaught:', err); process.exit(1); });

import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import admin from 'firebase-admin'
import dotenv from 'dotenv'

dotenv.config()

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIREBASE_WEB_API_KEY = process.env.FIREBASE_WEB_API_KEY
const BASE = 'http://localhost:3000'

// ── Firebase Admin setup ────────────────────────────────────────────
const keyPath = resolve(__dirname, 'smart-attendance-app-2f038-firebase-adminsdk-fbsvc-79631dd66a.json')
const serviceAccount = JSON.parse(readFileSync(keyPath, 'utf8'))

let adminApp
try { adminApp = admin.app('manual-tester') } catch {
    adminApp = admin.initializeApp({ credential: admin.credential.cert(serviceAccount) }, 'manual-tester')
}
const db = adminApp.firestore()
const auth = adminApp.auth()

// ── Helpers ──────────────────────────────────────────────────────────
async function req(method, path, body = null, token = null) {
    const headers = { 'Content-Type': 'application/json' }
    if (token) headers['Authorization'] = `Bearer ${token}`
    const opts = { method, headers }
    if (body) opts.body = JSON.stringify(body)
    const res = await fetch(`${BASE}${path}`, opts)
    return res.json()
}

async function getIdToken(uid) {
    const customToken = await auth.createCustomToken(uid)
    const res = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${FIREBASE_WEB_API_KEY}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: customToken, returnSecureToken: true }) }
    )
    const data = await res.json()
    return data.idToken
}

// ── Test Runner ──────────────────────────────────────────────────────
async function runTests() {
    const ts = Date.now()
    const teacherEmail = `teacher.demo.${ts}@saam.edu`
    const studentEmail = `student.demo.${ts}@saam.edu`

    console.log('--- SETUP (Admin Action) ---')
    // Register Teacher & Assign Department
    const regTeacher = await req('POST', '/api/auth/register/teacher', {
        name: 'Demo Teacher', email: teacherEmail, password: 'test1234',
        employeeId: 'T-DEMO', designation: 'Professor'
    })
    const teacherUid = regTeacher.uid
    const TEACHER_TOKEN = await getIdToken(teacherUid)
    await db.collection('teachers').doc(teacherUid).update({ departmentId: 'dept_demo', departmentName: 'Science' })
    console.log(`[+] Teacher created: ${teacherUid}`)

    // Register Student
    const regStudent = await req('POST', '/api/auth/register/student', {
        name: 'Demo Student', email: studentEmail, password: 'test1234',
        rollNumber: 'S-DEMO'
    })
    const studentUid = regStudent.uid
    const STUDENT_TOKEN = await getIdToken(studentUid)
    console.log(`[+] Student created: ${studentUid}\n`)


    console.log('============================================')
    console.log('Test 1 — Create a class')
    console.log('============================================')
    const createClassRes = await req('POST', '/api/classes', {
        subjectName: "Data Structures",
        subjectCode: "CS301",
        semester: 3,
        section: "A",
        batch: "2022-2026"
    }, TEACHER_TOKEN)
    console.log(JSON.stringify(createClassRes, null, 2))
    const CLASS_ID = createClassRes.data?.classId

    console.log('\n============================================')
    console.log('Test 2 — Add students')
    console.log('============================================')
    const addStudentsRes = await req('POST', `/api/classes/${CLASS_ID}/students`, {
        studentIds: [studentUid]
    }, TEACHER_TOKEN)
    console.log(JSON.stringify(addStudentsRes, null, 2))


    console.log('\n============================================')
    console.log('Test 3 — Student views their classes')
    console.log('============================================')
    const getClassesRes = await req('GET', '/api/classes/my-classes', null, STUDENT_TOKEN)
    console.log(JSON.stringify(getClassesRes, null, 2))


    console.log('\n============================================')
    console.log('Test 4 — Archive class')
    console.log('============================================')
    const archiveRes = await req('PATCH', `/api/classes/${CLASS_ID}/archive`, null, TEACHER_TOKEN)
    console.log(JSON.stringify(archiveRes, null, 2))


    // Cleanup
    await auth.deleteUser(teacherUid).catch(() => { })
    await auth.deleteUser(studentUid).catch(() => { })
    await db.collection('users').doc(teacherUid).delete().catch(() => { })
    await db.collection('users').doc(studentUid).delete().catch(() => { })
    await db.collection('classes').doc(CLASS_ID).delete().catch(() => { })

    console.log('\n--- CLEANUP DONE ---')
    process.exit(0)
}

runTests().catch(console.error)

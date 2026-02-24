/**
 * test-classes.js — Full Class API test script
 * Run with: node test-classes.js
 * Requires server running on port 3000
 */

import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import admin from 'firebase-admin'
import dotenv from 'dotenv'
dotenv.config()

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIREBASE_WEB_API_KEY = process.env.FIREBASE_WEB_API_KEY

// ── Firebase Admin setup ────────────────────────────────────────────
const keyPath = resolve(__dirname, 'smart-attendance-app-2f038-firebase-adminsdk-fbsvc-79631dd66a.json')
const serviceAccount = JSON.parse(readFileSync(keyPath, 'utf8'))

let adminApp
try { adminApp = admin.app('class-tester') } catch {
    adminApp = admin.initializeApp({ credential: admin.credential.cert(serviceAccount) }, 'class-tester')
}
const db = adminApp.firestore()
const auth = adminApp.auth()

// ── Helpers ──────────────────────────────────────────────────────────
const BASE = 'http://localhost:3000'
let passed = 0, failed = 0

async function req(method, path, body = null, token = null) {
    const headers = { 'Content-Type': 'application/json' }
    if (token) headers['Authorization'] = `Bearer ${token}`
    const opts = { method, headers }
    if (body) opts.body = JSON.stringify(body)
    const res = await fetch(`${BASE}${path}`, opts)
    return res.json()
}

function assert(label, condition, got) {
    if (condition) { console.log(`  ✅ PASS: ${label}`); passed++ }
    else { console.log(`  ❌ FAIL: ${label}`); console.log(`     Got:`, JSON.stringify(got, null, 2)); failed++ }
}

async function getIdToken(uid) {
    const customToken = await auth.createCustomToken(uid)
    const res = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${FIREBASE_WEB_API_KEY}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: customToken, returnSecureToken: true }) }
    )
    const data = await res.json()
    if (!data.idToken) throw new Error(`Token exchange failed: ${JSON.stringify(data.error)}`)
    return data.idToken
}

async function cleanup(email) {
    try {
        const u = await auth.getUserByEmail(email)
        await auth.deleteUser(u.uid)
        await db.collection('users').doc(u.uid).delete()
    } catch { }
}

async function cleanupClass(classId) {
    try { await db.collection('classes').doc(classId).delete() } catch { }
}

// ── Test Runner ──────────────────────────────────────────────────────
async function runTests() {
    const ts = Date.now()
    const teacherEmail = `teacher.cls.${ts}@saam.edu`
    const studentEmail = `student.cls.${ts}@saam.edu`
    let teacherToken, studentToken, teacherUid, studentUid, classId

    console.log('\n══════════════════════════════════════════')
    console.log('   SAAM Class API — Full Test Suite')
    console.log('══════════════════════════════════════════\n')

    // ── SETUP: Register teacher & student ────────
    console.log('🔧 SETUP: Creating test users')
    const regTeacher = await req('POST', '/api/auth/register', {
        name: 'Class Teacher', email: teacherEmail, password: 'test1234',
        role: 'teacher', employeeId: 'T100', department: 'Computer Science'
    })
    assert('Teacher registered', regTeacher.success === true, regTeacher)
    teacherUid = regTeacher.uid
    teacherToken = await getIdToken(teacherUid)

    const regStudent = await req('POST', '/api/auth/register', {
        name: 'Class Student', email: studentEmail, password: 'test1234',
        role: 'student', studentId: 'CS9999', department: 'Computer Science'
    })
    assert('Student registered', regStudent.success === true, regStudent)
    studentUid = regStudent.uid
    studentToken = await getIdToken(studentUid)

    // ── TEST 1: Create Class (validation) ────────
    console.log('\n📍 TEST 1: POST /api/classes — Validation')

    const noSubject = await req('POST', '/api/classes', { semester: 3 }, teacherToken)
    assert('Missing subjectName → VALIDATION_ERROR', noSubject.code === 'VALIDATION_ERROR', noSubject)

    const shortSubject = await req('POST', '/api/classes', { subjectName: 'AB', semester: 3 }, teacherToken)
    assert('Subject < 3 chars → VALIDATION_ERROR', shortSubject.code === 'VALIDATION_ERROR', shortSubject)

    const badSem = await req('POST', '/api/classes', { subjectName: 'Data Structures', semester: 10 }, teacherToken)
    assert('Semester 10 → VALIDATION_ERROR', badSem.code === 'VALIDATION_ERROR', badSem)

    const studentCreate = await req('POST', '/api/classes', { subjectName: 'Data Structures', semester: 3 }, studentToken)
    assert('Student creating class → TEACHER_ONLY', studentCreate.code === 'TEACHER_ONLY', studentCreate)

    // ── TEST 2: Create Class (success) ───────────
    console.log('\n📍 TEST 2: POST /api/classes — Success')
    const created = await req('POST', '/api/classes', {
        subjectName: 'Data Structures & Algorithms',
        subjectCode: 'CS301',
        semester: 3,
        academicYear: '2025-26'
    }, teacherToken)
    assert('success: true', created.success === true, created)
    assert('classId returned', !!created.classId, created)
    assert('subjectName correct', created.class?.subjectName === 'Data Structures & Algorithms', created)
    assert('semester is number 3', created.class?.semester === 3, created)
    assert('department from teacher profile', created.class?.department === 'Computer Science', created)
    classId = created.classId

    // ── TEST 3: Get Teacher Classes ───────────────
    console.log('\n📍 TEST 3: GET /api/classes/teacher')
    const classList = await req('GET', '/api/classes/teacher', null, teacherToken)
    assert('success: true', classList.success === true, classList)
    assert('returns array', Array.isArray(classList.classes), classList)
    assert('has the new class', classList.classes.some(c => c.id === classId), classList)
    assert('has studentCount field', classList.classes[0]?.studentCount !== undefined, classList)

    // ── TEST 4: Get Class By ID ───────────────────
    console.log('\n📍 TEST 4: GET /api/classes/:classId')
    const classDetail = await req('GET', `/api/classes/${classId}`, null, teacherToken)
    assert('success: true', classDetail.success === true, classDetail)
    assert('classId matches', classDetail.class?.id === classId, classDetail)
    assert('recentSessions array present', Array.isArray(classDetail.recentSessions), classDetail)

    const classNotFound = await req('GET', `/api/classes/invalid-id-999`, null, teacherToken)
    assert('Invalid classId → CLASS_NOT_FOUND', classNotFound.code === 'CLASS_NOT_FOUND', classNotFound)

    const classUnauth = await req('GET', `/api/classes/${classId}`, null, studentToken)
    assert('Non-member student → UNAUTHORIZED', classUnauth.code === 'UNAUTHORIZED', classUnauth)

    // ── TEST 5: Update Class ──────────────────────
    console.log('\n📍 TEST 5: PUT /api/classes/:classId')
    const updated = await req('PUT', `/api/classes/${classId}`, {
        subjectCode: 'CS301-A', academicYear: '2026-27'
    }, teacherToken)
    assert('success: true', updated.success === true, updated)
    assert('subjectCode updated', updated.class?.subjectCode === 'CS301-A', updated)

    const updateNoFields = await req('PUT', `/api/classes/${classId}`, {}, teacherToken)
    assert('Empty update → VALIDATION_ERROR', updateNoFields.code === 'VALIDATION_ERROR', updateNoFields)

    // ── TEST 6: Add Student ───────────────────────
    console.log('\n📍 TEST 6: POST /api/classes/:classId/students/add')
    const addStud = await req('POST', `/api/classes/${classId}/students/add`, { studentId: studentUid }, teacherToken)
    assert('success: true', addStud.success === true, addStud)
    assert('student name returned', addStud.student?.name === 'Class Student', addStud)

    const addDup = await req('POST', `/api/classes/${classId}/students/add`, { studentId: studentUid }, teacherToken)
    assert('Duplicate student → ALREADY_IN_CLASS', addDup.code === 'ALREADY_IN_CLASS', addDup)

    const addTeacherAsStudent = await req('POST', `/api/classes/${classId}/students/add`, { studentId: teacherUid }, teacherToken)
    assert('Add teacher as student → NOT_A_STUDENT', addTeacherAsStudent.code === 'NOT_A_STUDENT', addTeacherAsStudent)

    // ── TEST 7: Student can now access the class ──
    console.log('\n📍 TEST 7: Student access after being added')
    const studentView = await req('GET', `/api/classes/${classId}`, null, studentToken)
    assert('Student can now GET class details', studentView.success === true, studentView)

    // ── TEST 8: Import Students ───────────────────
    console.log('\n📍 TEST 8: POST /api/classes/:classId/students/import')
    const importRes = await req('POST', `/api/classes/${classId}/students/import`, {
        students: [
            { StudentName: 'Class Student', StudentID: 'CS9999', Email: studentEmail },
            { StudentName: 'Unknown Student', StudentID: 'XX0000', Email: 'unknown@test.com' }
        ]
    }, teacherToken)
    assert('success: true', importRes.success === true, importRes)
    assert('matched count returned', importRes.matched >= 0, importRes)
    assert('pending count returned', importRes.pending >= 0, importRes)
    assert('total = 2', importRes.total === 2, importRes)
    assert('unknown → pending', importRes.pending >= 1, importRes)
    console.log(`     matched: ${importRes.matched}, pending: ${importRes.pending}, total: ${importRes.total}`)

    // ── TEST 9: Get Class Students ────────────────
    console.log('\n📍 TEST 9: GET /api/classes/:classId/students')
    const studList = await req('GET', `/api/classes/${classId}/students`, null, teacherToken)
    assert('success: true', studList.success === true, studList)
    assert('registered is array', Array.isArray(studList.registered), studList)
    assert('pending is array', Array.isArray(studList.pending), studList)
    assert('student in registered list', studList.registered.some(s => s.uid === studentUid), studList)
    assert('attendancePercent field present', studList.registered[0]?.attendancePercent !== undefined, studList)
    assert('totalSessions field present', studList.totalSessions !== undefined, studList)

    // ── TEST 10: Remove Student ───────────────────
    console.log('\n📍 TEST 10: POST /api/classes/:classId/students/remove')
    const removeStud = await req('POST', `/api/classes/${classId}/students/remove`, {
        studentId: studentUid, isPending: false
    }, teacherToken)
    assert('success: true', removeStud.success === true, removeStud)

    // ── TEST 11: Delete Class ─────────────────────
    console.log('\n📍 TEST 11: DELETE /api/classes/:classId')
    const del = await req('DELETE', `/api/classes/${classId}`, null, teacherToken)
    assert('success: true', del.success === true, del)

    // Verify gone
    const gone = await req('GET', `/api/classes/${classId}`, null, teacherToken)
    assert('Deleted class → CLASS_NOT_FOUND', gone.code === 'CLASS_NOT_FOUND', gone)
    classId = null

    // ── Cleanup ───────────────────────────────────
    console.log('\n🧹 Cleaning up test users...')
    await cleanup(teacherEmail)
    await cleanup(studentEmail)
    if (classId) await cleanupClass(classId)
    console.log('   Done.')

    // ── Summary ───────────────────────────────────
    console.log('\n══════════════════════════════════════════')
    console.log(`   Results: ${passed} passed, ${failed} failed`)
    console.log('══════════════════════════════════════════\n')
    process.exit(failed > 0 ? 1 : 0)
}

runTests().catch(err => { console.error('Test runner crashed:', err); process.exit(1) })

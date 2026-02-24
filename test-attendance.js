/**
 * test-attendance.js — Full Attendance API test script
 * Run with: node test-attendance.js
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

// ── Firebase Admin ────────────────────────────────────────────────────────────
const keyPath = resolve(__dirname, 'smart-attendance-app-2f038-firebase-adminsdk-fbsvc-79631dd66a.json')
const serviceAccount = JSON.parse(readFileSync(keyPath, 'utf8'))
let adminApp
try { adminApp = admin.app('att-tester') } catch {
    adminApp = admin.initializeApp({ credential: admin.credential.cert(serviceAccount) }, 'att-tester')
}
const db = adminApp.firestore()
const auth = adminApp.auth()

// ── Helpers ───────────────────────────────────────────────────────────────────
const BASE = 'http://localhost:3000'
let passed = 0, failed = 0

async function req(method, path, body = null, token = null) {
    const headers = { 'Content-Type': 'application/json' }
    if (token) headers['Authorization'] = `Bearer ${token}`
    const opts = { method, headers }
    if (body) opts.body = JSON.stringify(body)
    const res = await fetch(`${BASE}${path}`, opts)
    // Export returns binary — just check status code
    if (res.headers.get('content-type')?.includes('spreadsheetml')) {
        return { __isExcel: true, status: res.status, size: (await res.arrayBuffer()).byteLength }
    }
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
    try { const u = await auth.getUserByEmail(email); await auth.deleteUser(u.uid); await db.collection('users').doc(u.uid).delete() } catch { }
}

async function deleteCollection(col, where) {
    const snap = await db.collection(col).where(...where).get()
    for (const d of snap.docs) await d.ref.delete()
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function runTests() {
    const ts = Date.now()
    const teacherEmail = `teacher.att.${ts}@saam.edu`
    const studentEmail = `student.att.${ts}@saam.edu`
    let teacherToken, studentToken, teacherUid, studentUid
    let classId, sessionId, qrCode, attendanceId

    console.log('\n══════════════════════════════════════════')
    console.log('   SAAM Attendance API — Full Test Suite')
    console.log('══════════════════════════════════════════\n')

    // ── SETUP ─────────────────────────────────────────────────────────────────
    console.log('🔧 SETUP: Creating test users, class, and session')

    const regT = await req('POST', '/api/auth/register', {
        name: 'Att Teacher', email: teacherEmail, password: 'test1234',
        role: 'teacher', employeeId: 'T300', department: 'CS'
    })
    assert('Teacher registered', regT.success === true, regT)
    teacherUid = regT.uid
    teacherToken = await getIdToken(teacherUid)

    const regS = await req('POST', '/api/auth/register', {
        name: 'Att Student', email: studentEmail, password: 'test1234',
        role: 'student', studentId: 'CS7777', department: 'CS'
    })
    assert('Student registered', regS.success === true, regS)
    studentUid = regS.uid
    studentToken = await getIdToken(studentUid)

    // Create class with student in it
    const classRef = await db.collection('classes').add({
        teacherId: teacherUid, subjectName: 'Attendance Test', subjectCode: 'AT101',
        semester: 3, department: 'CS', students: [studentUid], pendingStudents: [],
        totalSessions: 0, lastSessionDate: null,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
    })
    classId = classRef.id

    // Start a QR session
    const sessionStart = await req('POST', '/api/sessions/start', {
        classId, method: 'qr', lateAfterMinutes: 10, autoAbsentMinutes: 5, qrRefreshInterval: 30
    }, teacherToken)
    assert('QR session started', sessionStart.success === true, sessionStart)
    sessionId = sessionStart.sessionId
    qrCode = sessionStart.session?.qrCode
    console.log(`  ✅ Session ID: ${sessionId} | QR: ${qrCode}`)

    // ── TEST 1: Mark Attendance — Validation ──────────────────────────────────
    console.log('\n📍 TEST 1: POST /api/attendance/mark — Validation')

    const noSession = await req('POST', '/api/attendance/mark', { method: 'qr', qrCode }, studentToken)
    assert('No sessionId → VALIDATION_ERROR', noSession.code === 'VALIDATION_ERROR', noSession)

    const wrongQR = await req('POST', '/api/attendance/mark', { sessionId, method: 'qr', qrCode: 'wrong-code', faceVerified: true }, studentToken)
    assert('Wrong QR → INVALID_QR', wrongQR.code === 'INVALID_QR', wrongQR)

    // ── TEST 2: Mark — Face Failed ────────────────────────────────────────────
    console.log('\n📍 TEST 2: POST /api/attendance/mark — Face Failed')
    const faceFail = await req('POST', '/api/attendance/mark', {
        sessionId, method: 'qr', qrCode, faceVerified: false
    }, studentToken)
    assert('success: true', faceFail.success === true, faceFail)
    assert('status: face_failed', faceFail.status === 'face_failed', faceFail)
    assert('attendanceId returned', !!faceFail.attendanceId, faceFail)
    assert('message about teacher approval', faceFail.message?.includes('teacher approval'), faceFail)
    attendanceId = faceFail.attendanceId

    // ── TEST 3: Mark — QR Success (retry after face_failed) ───────────────────
    console.log('\n📍 TEST 3: POST /api/attendance/mark — QR Success (face verified)')
    const markOk = await req('POST', '/api/attendance/mark', {
        sessionId, method: 'qr', qrCode, faceVerified: true
    }, studentToken)
    assert('success: true', markOk.success === true, markOk)
    assert('status present or late', ['present', 'late'].includes(markOk.status), markOk)
    assert('attendanceId returned', !!markOk.attendanceId, markOk)
    assert('isLate boolean', typeof markOk.isLate === 'boolean', markOk)
    attendanceId = markOk.attendanceId

    // ── TEST 4: Duplicate mark ────────────────────────────────────────────────
    console.log('\n📍 TEST 4: Mark again → ALREADY_MARKED')
    const dup = await req('POST', '/api/attendance/mark', {
        sessionId, method: 'qr', qrCode, faceVerified: true
    }, studentToken)
    assert('Duplicate → ALREADY_MARKED', dup.code === 'ALREADY_MARKED', dup)

    // ── TEST 5: GET Session Attendance ────────────────────────────────────────
    console.log('\n📍 TEST 5: GET /api/attendance/session/:sessionId')
    const sessAtt = await req('GET', `/api/attendance/session/${sessionId}`, null, teacherToken)
    assert('success: true', sessAtt.success === true, sessAtt)
    assert('attendance.present array', Array.isArray(sessAtt.attendance?.present), sessAtt)
    assert('attendance.late array', Array.isArray(sessAtt.attendance?.late), sessAtt)
    assert('counts object present', !!sessAtt.counts, sessAtt)
    assert('counts.total ≥ 1', sessAtt.counts?.total >= 1, sessAtt)
    assert('student profile enriched', sessAtt.attendance?.present[0]?.student !== undefined || sessAtt.attendance?.late[0]?.student !== undefined, sessAtt)

    // ── TEST 6: Update Attendance Status ─────────────────────────────────────
    console.log('\n📍 TEST 6: PUT /api/attendance/:attendanceId/status')
    const statusUpdate = await req('PUT', `/api/attendance/${attendanceId}/status`, {
        status: 'late', teacherApproved: true, reason: 'Traffic delay'
    }, teacherToken)
    assert('success: true', statusUpdate.success === true, statusUpdate)
    assert('status updated to late', statusUpdate.attendance?.status === 'late', statusUpdate)

    const badStatus = await req('PUT', `/api/attendance/${attendanceId}/status`, { status: 'ghost' }, teacherToken)
    assert('Invalid status → VALIDATION_ERROR', badStatus.code === 'VALIDATION_ERROR', badStatus)

    // ── TEST 7: Manual Approve ────────────────────────────────────────────────
    console.log('\n📍 TEST 7: POST /api/attendance/manual-approve')
    // Manually approve another (non-existent) student — creates new record
    const manualApprove = await req('POST', '/api/attendance/manual-approve', {
        sessionId, studentId: studentUid, approved: true, reason: 'Front desk confirmation'
    }, teacherToken)
    assert('success: true', manualApprove.success === true, manualApprove)
    assert('status: present', manualApprove.status === 'present', manualApprove)

    // Teacher-only guard
    const studentApprove = await req('POST', '/api/attendance/manual-approve', {
        sessionId, studentId: teacherUid, approved: true
    }, studentToken)
    assert('Student cannot approve → TEACHER_ONLY', studentApprove.code === 'TEACHER_ONLY', studentApprove)

    // ── TEST 8: GET Student Attendance ────────────────────────────────────────
    console.log('\n📍 TEST 8: GET /api/attendance/student/:studentId')
    const studAtt = await req('GET', `/api/attendance/student/${studentUid}`, null, studentToken)
    assert('success: true', studAtt.success === true, studAtt)
    assert('records array returned', Array.isArray(studAtt.records), studAtt)
    assert('stats object returned', !!studAtt.stats, studAtt)
    assert('stats.totalClasses ≥ 1', studAtt.stats?.totalClasses >= 1, studAtt)
    assert('stats.percentage 0-100', studAtt.stats?.percentage >= 0 && studAtt.stats?.percentage <= 100, studAtt)

    // With classId filter
    const filteredAtt = await req('GET', `/api/attendance/student/${studentUid}?classId=${classId}`, null, studentToken)
    assert('classId filter works', filteredAtt.success === true, filteredAtt)

    // Teacher can view any student's attendance for their class
    const teacherViewStudent = await req('GET', `/api/attendance/student/${studentUid}?classId=${classId}`, null, teacherToken)
    assert('Teacher can view student attendance', teacherViewStudent.success === true, teacherViewStudent)

    // ── TEST 9: End session (becomes ended, auto-marks remaining absent) ───────
    console.log('\n📍 TEST 9: End session before report tests')
    const endSession = await req('POST', `/api/sessions/${sessionId}/end`, null, teacherToken)
    assert('Session ended', endSession.success === true, endSession)
    console.log(`     Present: ${endSession.summary?.totalPresent}, Late: ${endSession.summary?.totalLate}, Absent: ${endSession.summary?.totalAbsent}`)

    // ── TEST 10: GET Attendance Report ────────────────────────────────────────
    console.log('\n📍 TEST 10: GET /api/attendance/report/:classId')
    const report = await req('GET', `/api/attendance/report/${classId}`, null, teacherToken)
    assert('success: true', report.success === true, report)
    assert('sessions array', Array.isArray(report.sessions), report)
    assert('students array', Array.isArray(report.students), report)
    assert('stats object', !!report.stats, report)
    assert('stats.totalSessions ≥ 0', report.stats?.totalSessions >= 0, report)
    assert('stats.avgAttendance 0-100', report.stats?.avgAttendance >= 0, report)
    assert('stats.atRiskCount defined', report.stats?.atRiskCount !== undefined, report)

    // With date filter
    const today = new Date().toISOString().split('T')[0]
    const withDate = await req('GET', `/api/attendance/report/${classId}?fromDate=${today}&toDate=${today}`, null, teacherToken)
    assert('Date filter works', withDate.success === true, withDate)

    // ── TEST 11: Export Excel ─────────────────────────────────────────────────
    console.log('\n📍 TEST 11: GET /api/attendance/export/:classId')
    const excel = await req('GET', `/api/attendance/export/${classId}`, null, teacherToken)
    assert('Excel file returned', excel.__isExcel === true, excel)
    assert('File size > 0 bytes', excel.size > 0, excel)
    console.log(`     Excel file size: ${excel.size} bytes`)

    // ── TEST 12: GPS Out of Range ─────────────────────────────────────────────
    console.log('\n📍 TEST 12: GPS method — OUT_OF_RANGE check')

    // Start a GPS session for this test
    const gpsSessionRes = await req('POST', '/api/sessions/start', {
        classId, method: 'gps', teacherLat: 19.0760, teacherLng: 72.8777,
        radiusMeters: 30, lateAfterMinutes: 10
    }, teacherToken)
    assert('GPS session started', gpsSessionRes.success === true, gpsSessionRes)

    if (gpsSessionRes.success) {
        const gpsSessionId = gpsSessionRes.sessionId
        // Student is far away (Delhi vs Mumbai)
        const outOfRange = await req('POST', '/api/attendance/mark', {
            sessionId: gpsSessionId, method: 'gps',
            studentLat: 28.6139, studentLng: 77.2090, faceVerified: true
        }, studentToken)
        assert('Far student → OUT_OF_RANGE', outOfRange.code === 'OUT_OF_RANGE', outOfRange)
        assert('distance returned', outOfRange.distance !== undefined, outOfRange)
        assert('allowed metres returned', outOfRange.allowed === 30, outOfRange)

        // Student within range (same coords as teacher)
        const inRange = await req('POST', '/api/attendance/mark', {
            sessionId: gpsSessionId, method: 'gps',
            studentLat: 19.0761, studentLng: 72.8778, faceVerified: true
        }, studentToken)
        assert('Near student → marked', inRange.success === true && ['present', 'late'].includes(inRange.status), inRange)

        await req('POST', `/api/sessions/${gpsSessionId}/end`, null, teacherToken)
        await deleteCollection('attendance', ['sessionId', '==', gpsSessionId])
        await db.collection('sessions').doc(gpsSessionId).delete()
    }

    // ── Cleanup ───────────────────────────────────────────────────────────────
    console.log('\n🧹 Cleaning up...')
    await deleteCollection('attendance', ['classId', '==', classId])
    await deleteCollection('sessions', ['classId', '==', classId])
    await db.collection('classes').doc(classId).delete()
    await cleanup(teacherEmail)
    await cleanup(studentEmail)
    console.log('   Done.')

    console.log('\n══════════════════════════════════════════')
    console.log(`   Results: ${passed} passed, ${failed} failed`)
    console.log('══════════════════════════════════════════\n')
    process.exit(failed > 0 ? 1 : 0)
}

runTests().catch(err => { console.error('Test runner crashed:', err); process.exit(1) })

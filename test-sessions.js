/**
 * test-sessions.js — Full Session API test script
 * Run with: node test-sessions.js
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

// ── Firebase Admin ───────────────────────────────────────────────────
const keyPath = resolve(__dirname, 'smart-attendance-app-2f038-firebase-adminsdk-fbsvc-79631dd66a.json')
const serviceAccount = JSON.parse(readFileSync(keyPath, 'utf8'))
let adminApp
try { adminApp = admin.app('session-tester') } catch {
    adminApp = admin.initializeApp({ credential: admin.credential.cert(serviceAccount) }, 'session-tester')
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
    try { const u = await auth.getUserByEmail(email); await auth.deleteUser(u.uid); await db.collection('users').doc(u.uid).delete() } catch { }
}

async function cleanupDocs(collection, ids) {
    for (const id of ids) {
        try { await db.collection(collection).doc(id).delete() } catch { }
    }
}

// ── Test Runner ──────────────────────────────────────────────────────
async function runTests() {
    const ts = Date.now()
    const teacherEmail = `teacher.ses.${ts}@saam.edu`
    const studentEmail = `student.ses.${ts}@saam.edu`
    let teacherToken, studentToken, teacherUid, studentUid
    let classId, sessionId
    const createdSessions = []

    console.log('\n══════════════════════════════════════════')
    console.log('   SAAM Session API — Full Test Suite')
    console.log('══════════════════════════════════════════\n')

    // ── SETUP ────────────────────────────────────────
    console.log('🔧 SETUP: Creating test users & class')

    const regT = await req('POST', '/api/auth/register', {
        name: 'Session Teacher', email: teacherEmail, password: 'test1234',
        role: 'teacher', employeeId: 'T200', department: 'CS'
    })
    assert('Teacher registered', regT.success === true, regT)
    teacherUid = regT.uid
    teacherToken = await getIdToken(teacherUid)

    const regS = await req('POST', '/api/auth/register', {
        name: 'Session Student', email: studentEmail, password: 'test1234',
        role: 'student', studentId: 'CS8888', department: 'CS'
    })
    assert('Student registered', regS.success === true, regS)
    studentUid = regS.uid
    studentToken = await getIdToken(studentUid)

    // Create class manually in Firestore to tie to teacher
    const classRef = await db.collection('classes').add({
        teacherId: teacherUid,
        subjectName: 'Session Test Subject',
        subjectCode: 'ST101',
        semester: 2,
        department: 'CS',
        students: [studentUid],
        pendingStudents: [],
        totalSessions: 0,
        lastSessionDate: null,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
    })
    classId = classRef.id
    console.log(`  ✅ Class created: ${classId}`)

    // ── TEST 1: Start Session — Validation ────────────
    console.log('\n📍 TEST 1: POST /api/sessions/start — Validation')

    const noClass = await req('POST', '/api/sessions/start', { method: 'qr' }, teacherToken)
    assert('No classId → VALIDATION_ERROR', noClass.code === 'VALIDATION_ERROR', noClass)

    const badMethod = await req('POST', '/api/sessions/start', { classId, method: 'bluetooth_le' }, teacherToken)
    assert('Invalid method → VALIDATION_ERROR', badMethod.code === 'VALIDATION_ERROR', badMethod)

    const gpsNoCoords = await req('POST', '/api/sessions/start', { classId, method: 'gps' }, teacherToken)
    assert('GPS without coords → VALIDATION_ERROR', gpsNoCoords.code === 'VALIDATION_ERROR', gpsNoCoords)

    const studentStart = await req('POST', '/api/sessions/start', { classId, method: 'qr' }, studentToken)
    assert('Student starting session → UNAUTHORIZED', studentStart.code === 'UNAUTHORIZED', studentStart)

    // ── TEST 2: Start QR Session ──────────────────────
    console.log('\n📍 TEST 2: POST /api/sessions/start — QR Session')
    const qrSession = await req('POST', '/api/sessions/start', {
        classId, method: 'qr', lateAfterMinutes: 5, autoAbsentMinutes: 10, qrRefreshInterval: 30
    }, teacherToken)
    assert('success: true', qrSession.success === true, qrSession)
    assert('sessionId returned', !!qrSession.sessionId, qrSession)
    assert('status is active', qrSession.session?.status === 'active', qrSession)
    assert('qrCode generated', !!qrSession.session?.qrCode, qrSession)
    assert('method is qr', qrSession.session?.method === 'qr', qrSession)
    sessionId = qrSession.sessionId
    createdSessions.push(sessionId)

    // ── TEST 3: Duplicate active session ──────────────
    console.log('\n📍 TEST 3: Start duplicate session → SESSION_ALREADY_ACTIVE')
    const dupSession = await req('POST', '/api/sessions/start', { classId, method: 'network' }, teacherToken)
    assert('success: false', dupSession.success === false, dupSession)
    assert('code: SESSION_ALREADY_ACTIVE', dupSession.code === 'SESSION_ALREADY_ACTIVE', dupSession)
    assert('existingSessionId returned', dupSession.existingSessionId === sessionId, dupSession)

    // ── TEST 4: Get Active Session ────────────────────
    console.log('\n📍 TEST 4: GET /api/sessions/active/:classId')
    const active = await req('GET', `/api/sessions/active/${classId}`, null, teacherToken)
    assert('success: true', active.success === true, active)
    assert('activeSession not null', active.activeSession !== null, active)
    assert('id matches', active.activeSession?.id === sessionId, active)

    // No active session for unknown class
    const noActive = await req('GET', `/api/sessions/active/fakeclassid`, null, teacherToken)
    assert('Unknown class → null activeSession', noActive.activeSession === null, noActive)

    // ── TEST 5: Get Session By ID ─────────────────────
    console.log('\n📍 TEST 5: GET /api/sessions/:sessionId')
    const byId = await req('GET', `/api/sessions/${sessionId}`, null, teacherToken)
    assert('success: true', byId.success === true, byId)
    assert('session object returned', !!byId.session, byId)
    assert('stats object returned', !!byId.stats, byId)
    assert('stats has present/late/absent', byId.stats?.present !== undefined, byId)

    const unauthorized = await req('GET', `/api/sessions/${sessionId}`, null, studentToken)
    // student IS in class.students so should be allowed
    assert('Student in class can view session', unauthorized.success === true, unauthorized)

    // ── TEST 6: Update QR Code ────────────────────────
    console.log('\n📍 TEST 6: PUT /api/sessions/:sessionId/qr')
    const oldQR = qrSession.session?.qrCode
    const qrUpdate = await req('PUT', `/api/sessions/${sessionId}/qr`, null, teacherToken)
    assert('success: true', qrUpdate.success === true, qrUpdate)
    assert('new qrCode returned', !!qrUpdate.qrCode, qrUpdate)
    assert('qrCode is different from original', qrUpdate.qrCode !== oldQR, qrUpdate)

    // ── TEST 7: Get Session Stats ─────────────────────
    console.log('\n📍 TEST 7: GET /api/sessions/:sessionId/stats')
    const stats = await req('GET', `/api/sessions/${sessionId}/stats`, null, teacherToken)
    assert('success: true', stats.success === true, stats)
    assert('stats.presentCount defined', stats.stats?.presentCount !== undefined, stats)
    assert('stats.attendanceRate defined', stats.stats?.attendanceRate !== undefined, stats)
    assert('stats.manualApprovalCount defined', stats.stats?.manualApprovalCount !== undefined, stats)

    // ── TEST 8: Get Class Sessions ────────────────────
    console.log('\n📍 TEST 8: GET /api/sessions/class/:classId')
    const classSessions = await req('GET', `/api/sessions/class/${classId}`, null, teacherToken)
    assert('success: true', classSessions.success === true, classSessions)
    assert('sessions array returned', Array.isArray(classSessions.sessions), classSessions)
    assert('includes our session', classSessions.sessions.some(s => s.id === sessionId), classSessions)

    // with status filter
    const endedOnly = await req('GET', `/api/sessions/class/${classId}?status=ended`, null, teacherToken)
    assert('status=ended filter works', !endedOnly.sessions?.some(s => s.status === 'active'), endedOnly)

    // ── TEST 9: End Session ───────────────────────────
    console.log('\n📍 TEST 9: POST /api/sessions/:sessionId/end')
    const ended = await req('POST', `/api/sessions/${sessionId}/end`, null, teacherToken)
    assert('success: true', ended.success === true, ended)
    assert('summary returned', !!ended.summary, ended)
    assert('totalAbsent ≥ 0', ended.summary?.totalAbsent >= 0, ended)
    assert('duration returned', !!ended.summary?.duration, ended)
    assert('duration has formatted', !!ended.summary?.duration?.formatted, ended)
    console.log(`     Duration: ${ended.summary?.duration?.formatted}, Absent: ${ended.summary?.totalAbsent}`)

    // ── TEST 10: Double end → SESSION_NOT_ACTIVE ──────
    console.log('\n📍 TEST 10: End already-ended session')
    const doubleEnd = await req('POST', `/api/sessions/${sessionId}/end`, null, teacherToken)
    assert('Already ended → SESSION_NOT_ACTIVE', doubleEnd.code === 'SESSION_NOT_ACTIVE', doubleEnd)

    // ── TEST 11: Active session is now null ───────────
    console.log('\n📍 TEST 11: Active session is null after ending')
    const noMoreActive = await req('GET', `/api/sessions/active/${classId}`, null, teacherToken)
    assert('activeSession is null after end', noMoreActive.activeSession === null, noMoreActive)

    // ── TEST 12: Start GPS session ────────────────────
    console.log('\n📍 TEST 12: POST /api/sessions/start — GPS Session')
    const gpsSession = await req('POST', '/api/sessions/start', {
        classId, method: 'gps',
        teacherLat: 19.0760, teacherLng: 72.8777, radiusMeters: 50,
        lateAfterMinutes: 10
    }, teacherToken)
    assert('GPS session created', gpsSession.success === true, gpsSession)
    assert('has teacherLat', gpsSession.session?.teacherLat === 19.0760, gpsSession)
    assert('has radiusMeters', gpsSession.session?.radiusMeters === 50, gpsSession)
    if (gpsSession.sessionId) {
        createdSessions.push(gpsSession.sessionId)
        // End it immediately
        await req('POST', `/api/sessions/${gpsSession.sessionId}/end`, null, teacherToken)
    }

    // ── Cleanup ───────────────────────────────────────
    console.log('\n🧹 Cleaning up...')
    await cleanupDocs('sessions', createdSessions)
    // Clean up attendance records created
    const attSnap = await db.collection('attendance').where('classId', '==', classId).get()
    await cleanupDocs('attendance', attSnap.docs.map(d => d.id))
    await db.collection('classes').doc(classId).delete()
    await cleanup(teacherEmail)
    await cleanup(studentEmail)
    console.log('   Done.')

    // ── Summary ───────────────────────────────────────
    console.log('\n══════════════════════════════════════════')
    console.log(`   Results: ${passed} passed, ${failed} failed`)
    console.log('══════════════════════════════════════════\n')
    process.exit(failed > 0 ? 1 : 0)
}

runTests().catch(err => { console.error('Test runner crashed:', err); process.exit(1) })

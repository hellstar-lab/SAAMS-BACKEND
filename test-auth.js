/**
 * test-auth.js — Full Auth API test script
 * Run with: node test-auth.js
 * Requires server to be running on port 3000
 */

import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import admin from 'firebase-admin'
import dotenv from 'dotenv'
dotenv.config()

const __dirname = dirname(fileURLToPath(import.meta.url))

// ── Firebase Web API Key (from .env) ──────────────────────────────
const FIREBASE_WEB_API_KEY = process.env.FIREBASE_WEB_API_KEY

// ── Init Firebase Admin ────────────────────────────────────────────
const keyPath = resolve(__dirname, 'smart-attendance-app-2f038-firebase-adminsdk-fbsvc-79631dd66a.json')
const serviceAccount = JSON.parse(readFileSync(keyPath, 'utf8'))

let adminApp
try {
    adminApp = admin.app('tester')
} catch {
    adminApp = admin.initializeApp({ credential: admin.credential.cert(serviceAccount) }, 'tester')
}

const db = adminApp.firestore()
const auth = adminApp.auth()

// ── Helpers ────────────────────────────────────────────────────────
const BASE = 'http://localhost:3000'
let passed = 0
let failed = 0

async function request(method, path, body = null, token = null) {
    const headers = { 'Content-Type': 'application/json' }
    if (token) headers['Authorization'] = `Bearer ${token}`
    const opts = { method, headers }
    if (body) opts.body = JSON.stringify(body)
    const res = await fetch(`${BASE}${path}`, opts)
    return await res.json()
}

function assert(label, condition, got) {
    if (condition) {
        console.log(`  ✅ PASS: ${label}`)
        passed++
    } else {
        console.log(`  ❌ FAIL: ${label}`)
        console.log(`     Got:`, JSON.stringify(got, null, 2))
        failed++
    }
}

async function getIdToken(uid) {
    const customToken = await auth.createCustomToken(uid)
    const res = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${FIREBASE_WEB_API_KEY}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: customToken, returnSecureToken: true })
        }
    )
    const data = await res.json()
    if (!data.idToken) throw new Error(`Token exchange failed: ${JSON.stringify(data.error)}`)
    return data.idToken
}

async function cleanup(email) {
    try {
        const user = await auth.getUserByEmail(email)
        await auth.deleteUser(user.uid)
        await db.collection('teachers').doc(user.uid).delete()
        await db.collection('students').doc(user.uid).delete()
    } catch (e) { /* already deleted */ }
}

// ── Tests ──────────────────────────────────────────────────────────
async function runTests() {
    const ts = Date.now()
    const teacherEmail = `teacher.test.${ts}@saam.edu`
    const studentEmail = `student.test.${ts}@saam.edu`
    let teacherUid = null
    let studentUid = null
    let idToken = null

    console.log('\n══════════════════════════════════════════')
    console.log('   SAAM Auth API — Full Test Suite (1-12)')
    console.log('══════════════════════════════════════════\n')

    // ── TEST 1: Health check ─────────────────────
    console.log('📍 TEST 1: Health Check')
    const health = await request('GET', '/health')
    assert('success: true', health.success === true, health)
    assert('status: ok', health.status === 'ok', health)

    // ── TEST 2: Validation errors ─────────────────
    console.log('\n📍 TEST 2: Validation Errors')
    const missing = await request('POST', '/api/auth/register', { email: 'x@x.com', password: 'pass1234' })
    assert('Missing fields → VALIDATION_ERROR', missing.code === 'VALIDATION_ERROR', missing)

    const badEmail = await request('POST', '/api/auth/register', { name: 'T', email: 'notanemail', password: 'pass1234', role: 'teacher' })
    assert('Bad email → INVALID_EMAIL', badEmail.code === 'INVALID_EMAIL', badEmail)

    const shortPass = await request('POST', '/api/auth/register', { name: 'T', email: 'x@x.com', password: 'abc', role: 'teacher' })
    assert('Short password → WEAK_PASSWORD', shortPass.code === 'WEAK_PASSWORD', shortPass)

    const badRole = await request('POST', '/api/auth/register', { name: 'T', email: 'x@x.com', password: 'pass1234', role: 'admin' })
    assert('Bad role → INVALID_ROLE', badRole.code === 'INVALID_ROLE', badRole)

    // ── TEST 3: Register Teacher ─────────────────
    console.log('\n📍 TEST 3: Register Teacher')
    const regTeacher = await request('POST', '/api/auth/register', {
        name: 'Test Teacher', email: teacherEmail, password: 'test1234',
        role: 'teacher', employeeId: 'T002', department: 'Computer Science'
    })
    assert('success: true', regTeacher.success === true, regTeacher)
    assert('has uid', !!regTeacher.uid, regTeacher)
    assert('role is teacher', regTeacher.user?.role === 'teacher', regTeacher)
    assert('employeeId saved', regTeacher.user?.employeeId === 'T002', regTeacher)
    teacherUid = regTeacher.uid

    // ── TEST 4: Register Student ─────────────────
    console.log('\n📍 TEST 4: Register Student')
    const regStudent = await request('POST', '/api/auth/register', {
        name: 'Test Student', email: studentEmail, password: 'test1234',
        role: 'student', studentId: 'CS2201', department: 'Computer Science'
    })
    assert('success: true', regStudent.success === true, regStudent)
    assert('role is student', regStudent.user?.role === 'student', regStudent)
    assert('studentId saved', regStudent.user?.studentId === 'CS2201', regStudent)
    studentUid = regStudent.uid

    // ── TEST 5: Duplicate email ──────────────────
    console.log('\n📍 TEST 5: Duplicate Email')
    const dup = await request('POST', '/api/auth/register', {
        name: 'Test Teacher', email: teacherEmail, password: 'test1234',
        role: 'teacher', employeeId: 'T002'
    })
    assert('success: false', dup.success === false, dup)
    assert('code: EMAIL_EXISTS', dup.code === 'EMAIL_EXISTS', dup)

    // ── TEST 6: Login / Token Verification ───────
    console.log('\n📍 TEST 6: POST /api/auth/login — Token Verification')
    idToken = await getIdToken(teacherUid)
    assert('Got idToken successfully', !!idToken)

    const login = await request('POST', '/api/auth/login', { idToken })
    assert('Login success: true', login.success === true, login)
    assert('uid matches teacher', login.user?.uid === teacherUid, login)
    assert('name correct', login.user?.name === 'Test Teacher', login)

    // ── TEST 7: Login without idToken ────────────
    console.log('\n📍 TEST 7: POST /api/auth/login — Missing Token')
    const noToken = await request('POST', '/api/auth/login', {})
    assert('Missing idToken → VALIDATION_ERROR', noToken.code === 'VALIDATION_ERROR', noToken)

    // ── TEST 8: GET Profile ──────────────────────
    console.log('\n📍 TEST 8: GET /api/auth/profile')
    const profile = await request('GET', '/api/auth/profile', null, idToken)
    assert('success: true', profile.success === true, profile)
    assert('uid matches', profile.user?.uid === teacherUid, profile)
    assert('faceData NOT returned (excluded)', !('faceData' in (profile.user || {})), profile)
    assert('email correct', profile.user?.email === teacherEmail, profile)

    // ── TEST 9: GET Profile without token ────────
    console.log('\n📍 TEST 9: GET /api/auth/profile — Unauthorized')
    const unauth = await request('GET', '/api/auth/profile')
    assert('No token → AUTH_REQUIRED', unauth.code === 'AUTH_REQUIRED', unauth)

    // ── TEST 10: PUT Profile ─────────────────────
    console.log('\n📍 TEST 10: PUT /api/auth/profile')
    const updated = await request('PUT', '/api/auth/profile',
        { name: 'Updated Teacher Name', phone: '9876543210' }, idToken)
    assert('success: true', updated.success === true, updated)
    assert('name updated', updated.user?.name === 'Updated Teacher Name', updated)
    assert('phone saved', updated.user?.phone === '9876543210', updated)

    // Verify name also updated in Firebase Auth
    const fbUser = await auth.getUser(teacherUid)
    assert('Firebase Auth displayName updated', fbUser.displayName === 'Updated Teacher Name', fbUser.displayName)

    // ── TEST 11: Change Password ─────────────────
    console.log('\n📍 TEST 11: POST /api/auth/change-password')
    const changePw = await request('POST', '/api/auth/change-password', { newPassword: 'newSecure456' }, idToken)
    assert('success: true', changePw.success === true, changePw)
    assert('message correct', changePw.message === 'Password changed successfully', changePw)

    const shortPw = await request('POST', '/api/auth/change-password', { newPassword: 'abc' }, idToken)
    assert('Short new password → WEAK_PASSWORD', shortPw.code === 'WEAK_PASSWORD', shortPw)

    // ── TEST 12: Delete Account ──────────────────
    console.log('\n📍 TEST 12: DELETE /api/auth/account (student)')
    const studentToken = await getIdToken(studentUid)
    const del = await request('DELETE', '/api/auth/account', null, studentToken)
    assert('success: true', del.success === true, del)

    // Verify deletion from Firestore (students collection)
    const studentDoc = await db.collection('students').doc(studentUid).get()
    assert('Firestore doc deleted', !studentDoc.exists, { exists: studentDoc.exists })

    // Verify deletion from Firebase Auth
    let authDeleted = false
    try {
        await auth.getUser(studentUid)
    } catch (e) {
        authDeleted = e.code === 'auth/user-not-found'
    }
    assert('Firebase Auth user deleted', authDeleted)

    // ── Cleanup remaining test users ─────────────
    console.log('\n🧹 Cleaning up test users...')
    await cleanup(teacherEmail)
    await cleanup(studentEmail)
    console.log('   Done.')

    // ── Summary ──────────────────────────────────
    console.log('\n══════════════════════════════════════════')
    console.log(`   Results: ${passed} passed, ${failed} failed`)
    console.log('══════════════════════════════════════════\n')

    process.exit(failed > 0 ? 1 : 0)
}

runTests().catch(err => { console.error('Test runner crashed:', err); process.exit(1) })

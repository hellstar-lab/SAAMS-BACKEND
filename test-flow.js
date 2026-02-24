import fetch from 'node-fetch'
import admin from 'firebase-admin'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'

dotenv.config()

const BASE = 'http://localhost:3000'
const FIREBASE_WEB_API_KEY = process.env.FIREBASE_WEB_API_KEY || ''

async function req(method, path, body = null, token = null) {
    const headers = { 'Content-Type': 'application/json' }
    if (token) headers['Authorization'] = `Bearer ${token}`
    const opts = { method, headers }
    if (body) opts.body = JSON.stringify(body)
    const res = await fetch(`${BASE}${path}`, opts)
    const data = await res.json()
    if (!data.success) {
        console.error(`❌ API Error [${method} ${path}]:`, data)
        throw new Error(`API call failed: ${data.error || data.message}`)
    }
    return data
}

async function getIdToken(uid) {
    const customToken = await admin.auth().createCustomToken(uid)
    const res = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${FIREBASE_WEB_API_KEY}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: customToken, returnSecureToken: true }) }
    )
    const data = await res.json()
    return data.idToken
}

async function run() {
    console.log('--- Starting Full E2E Flow ---')
    const ts = Date.now()
    try {
        // 1. Register Teacher
        console.log('1. Registering Teacher...')
        const tReg = await req('POST', '/api/auth/register', {
            name: 'Flow Teacher', email: `teacher${ts}@test.com`, password: 'password123', role: 'teacher', employeeId: `T${ts}`
        })
        const tToken = await getIdToken(tReg.uid)

        // 2. Teacher creates Class
        console.log('2. Creating Class...')
        const cRes = await req('POST', '/api/classes', {
            subjectName: 'Flow Testing 101', subjectCode: 'FLOW101', semester: 1
        }, tToken)
        const classId = cRes.classId

        // 3. Register Student
        console.log('3. Registering Student...')
        const sReg = await req('POST', '/api/auth/register', {
            name: 'Flow Student', email: `student${ts}@test.com`, password: 'password123', role: 'student', studentId: `S${ts}`
        })
        const sToken = await getIdToken(sReg.uid)

        // 4. Add Student to Class
        console.log('4. Adding Student to Class...')
        await req('POST', `/api/classes/${classId}/students/add`, { studentId: sReg.uid }, tToken)

        // 5. Start Session (QR)
        console.log('5. Starting QR Session...')
        const sessRes = await req('POST', '/api/sessions/start', {
            classId, method: 'qr'
        }, tToken)
        const sessionId = sessRes.sessionId
        const qrCode = sessRes.session.qrCode

        // 6. Student Marks Attendance
        console.log('6. Student Marking Attendance...')
        await req('POST', '/api/attendance/mark', {
            sessionId, method: 'qr', qrCode, faceVerified: true
        }, sToken)

        // 7. End Session
        console.log('7. Ending Session...')
        await req('POST', `/api/sessions/${sessionId}/end`, null, tToken)

        // 8. Generate Report
        console.log('8. Generating Report...')
        const report = await req('GET', `/api/attendance/report/${classId}`, null, tToken)
        console.log('Report generated successfully with stats:', report.stats)

        console.log('✅ ALL FLOWS COMPLETED SUCCESSFULLY')
    } catch (e) {
        console.error('💥 E2E FLOW FAILED:', e.message)
        process.exit(1)
    }
}

// ensure firebase admin is initialized
const __dirname = dirname(fileURLToPath(import.meta.url))
const keyPath = resolve(__dirname, 'smart-attendance-app-2f038-firebase-adminsdk-fbsvc-79631dd66a.json')
const serviceAccount = JSON.parse(readFileSync(keyPath, 'utf8'))
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })

run()

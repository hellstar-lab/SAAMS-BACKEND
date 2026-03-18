/**
 * Test script: generate tokens and test network attendance endpoints
 */
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import admin from 'firebase-admin'
import dotenv from 'dotenv'

dotenv.config()

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIREBASE_WEB_API_KEY = process.env.FIREBASE_WEB_API_KEY
const BASE_URL = 'https://saams-backend-l7i5.onrender.com/api'
const CLASS_ID = 'FLdBwnA3MkK2nK8lvZbS'
const SESSION_ID = 'FpVOSUcN1IhVQL7ADNOA'

const keyPath = resolve(__dirname, 'smart-attendance-app-2f038-firebase-adminsdk-fbsvc-79631dd66a.json')
const serviceAccount = JSON.parse(readFileSync(keyPath, 'utf8'))

let adminApp
try { adminApp = admin.app('test-network') } catch {
    adminApp = admin.initializeApp({ credential: admin.credential.cert(serviceAccount) }, 'test-network')
}
const auth = adminApp.auth()
const db = adminApp.firestore()

async function getIdToken(uid) {
    const customToken = await auth.createCustomToken(uid)
    const res = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${FIREBASE_WEB_API_KEY}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: customToken, returnSecureToken: true }) }
    )
    const data = await res.json()
    if (!data.idToken) {
        console.error('❌ Failed to get ID token:', data)
        return null
    }
    return data.idToken
}

async function run() {
    try {
        // Step 1: Find the class to get teacherId and students
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
        console.log('📋 STEP 1: Looking up class and session...')
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
        
        const classDoc = await db.collection('classes').doc(CLASS_ID).get()
        if (!classDoc.exists) {
            console.error('❌ Class not found:', CLASS_ID)
            process.exit(1)
        }
        const classData = classDoc.data()
        console.log('✅ Class found:', classData.subjectName || classData.name)
        console.log('   Teacher ID:', classData.teacherId)
        console.log('   Students:', classData.students?.length || 0)

        // Step 2: Find student "Aarav Sharma"
        let studentUid = null
        if (classData.students && classData.students.length > 0) {
            for (const uid of classData.students) {
                const studentDoc = await db.collection('students').doc(uid).get()
                if (studentDoc.exists) {
                    const sData = studentDoc.data()
                    console.log(`   → Student: ${sData.name} (${uid})`)
                    if (sData.name && sData.name.includes('Aarav')) {
                        studentUid = uid
                    }
                }
            }
        }
        
        if (!studentUid && classData.students?.length > 0) {
            studentUid = classData.students[0]
            console.log('   ⚠️  Aarav Sharma not found, using first student:', studentUid)
        }

        // Step 3: Check the session
        const sessionDoc = await db.collection('sessions').doc(SESSION_ID).get()
        if (sessionDoc.exists) {
            const sessionData = sessionDoc.data()
            console.log('\n📋 Session info:')
            console.log('   Status:', sessionData.status)
            console.log('   Method:', sessionData.method)
            console.log('   normalizedSSID:', sessionData.normalizedSSID)
        } else {
            console.log('\n⚠️  Session', SESSION_ID, 'not found')
        }

        // Step 4: Generate tokens
        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
        console.log('🔑 STEP 2: Generating Firebase ID Tokens...')
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

        const teacherToken = await getIdToken(classData.teacherId)
        console.log('✅ Teacher token generated (first 50 chars):', teacherToken?.substring(0, 50) + '...')

        let studentToken = null
        if (studentUid) {
            studentToken = await getIdToken(studentUid)
            console.log('✅ Student token generated (first 50 chars):', studentToken?.substring(0, 50) + '...')
        }

        // Step 5: Test mark attendance with matching SSID
        if (studentToken && sessionDoc.exists && sessionDoc.data().status === 'active') {
            const ssid = sessionDoc.data().normalizedSSID || 'college_wifi'
            
            console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
            console.log('✅ TEST 1: Mark attendance with MATCHING SSID ("' + ssid + '")')
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

            const markRes = await fetch(`${BASE_URL}/attendance/mark`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${studentToken}` },
                body: JSON.stringify({ sessionId: SESSION_ID, method: 'network', studentSSID: ssid })
            })
            const markData = await markRes.json()
            console.log('   HTTP Status:', markRes.status)
            console.log('   Response:', JSON.stringify(markData, null, 2))

            // Test 2: Duplicate attendance
            console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
            console.log('🔄 TEST 2: Duplicate attendance (same student, same session)')
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
            
            const dupRes = await fetch(`${BASE_URL}/attendance/mark`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${studentToken}` },
                body: JSON.stringify({ sessionId: SESSION_ID, method: 'network', studentSSID: ssid })
            })
            const dupData = await dupRes.json()
            console.log('   HTTP Status:', dupRes.status)
            console.log('   Response:', JSON.stringify(dupData, null, 2))

        } else if (sessionDoc.exists && sessionDoc.data().status !== 'active') {
            console.log('\n⚠️  Session is not active (status:', sessionDoc.data().status + '). Creating a NEW session...')
            
            // Create a new network session
            console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
            console.log('🆕 Creating NEW network session...')
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
            
            const createRes = await fetch(`${BASE_URL}/sessions/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${teacherToken}` },
                body: JSON.stringify({
                    classId: CLASS_ID,
                    method: 'network',
                    expectedSSID: 'college_wifi',
                    lateAfterMinutes: 10,
                    autoAbsentMinutes: 15
                })
            })
            const createData = await createRes.json()
            console.log('   HTTP Status:', createRes.status)
            console.log('   Response:', JSON.stringify(createData, null, 2))

            if (createData.success && createData.data?.sessionId) {
                const newSessionId = createData.data.sessionId

                // TEST 1: Matching SSID 
                console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
                console.log('✅ TEST 1: Mark attendance with MATCHING SSID')
                console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
                
                const markRes = await fetch(`${BASE_URL}/attendance/mark`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${studentToken}` },
                    body: JSON.stringify({ sessionId: newSessionId, method: 'network', studentSSID: 'college_wifi' })
                })
                const markData = await markRes.json()
                console.log('   HTTP Status:', markRes.status)
                console.log('   Response:', JSON.stringify(markData, null, 2))

                // TEST 2: Duplicate
                console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
                console.log('🔄 TEST 2: Duplicate attendance')
                console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
                
                const dupRes = await fetch(`${BASE_URL}/attendance/mark`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${studentToken}` },
                    body: JSON.stringify({ sessionId: newSessionId, method: 'network', studentSSID: 'college_wifi' })
                })
                const dupData = await dupRes.json()
                console.log('   HTTP Status:', dupRes.status)
                console.log('   Response:', JSON.stringify(dupData, null, 2))

                // TEST 3: Wrong SSID (need another student or skip)
                // Use a different student if available
                let otherStudentUid = null
                if (classData.students?.length > 1) {
                    otherStudentUid = classData.students.find(s => s !== studentUid)
                }
                if (otherStudentUid) {
                    const otherToken = await getIdToken(otherStudentUid)
                    
                    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
                    console.log('❌ TEST 3: Network MISMATCH (wrong SSID)')
                    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
                    
                    const mismatchRes = await fetch(`${BASE_URL}/attendance/mark`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${otherToken}` },
                        body: JSON.stringify({ sessionId: newSessionId, method: 'network', studentSSID: 'home_wifi' })
                    })
                    const mismatchData = await mismatchRes.json()
                    console.log('   HTTP Status:', mismatchRes.status)
                    console.log('   Response:', JSON.stringify(mismatchData, null, 2))

                    // TEST 4: Missing SSID
                    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
                    console.log('🚫 TEST 4: Missing studentSSID')
                    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
                    
                    const missingRes = await fetch(`${BASE_URL}/attendance/mark`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${otherToken}` },
                        body: JSON.stringify({ sessionId: newSessionId, method: 'network' })
                    })
                    const missingData = await missingRes.json()
                    console.log('   HTTP Status:', missingRes.status)
                    console.log('   Response:', JSON.stringify(missingData, null, 2))

                    // TEST 5: Rate limiting (3 more wrong attempts)
                    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
                    console.log('⏱️  TEST 5: Rate limiting (3 more failed attempts)')
                    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
                    
                    // Already 1 failed attempt from TEST 3, need 2 more then the 4th should be rate limited
                    for (let i = 2; i <= 4; i++) {
                        const rlRes = await fetch(`${BASE_URL}/attendance/mark`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${otherToken}` },
                            body: JSON.stringify({ sessionId: newSessionId, method: 'network', studentSSID: 'wrong_wifi' })
                        })
                        const rlData = await rlRes.json()
                        console.log(`   Attempt ${i} → HTTP ${rlRes.status}: ${rlData.code || 'success'} - ${rlData.error || rlData.message || ''}`)
                    }
                }

                // TEST 6: Verify Firestore document
                console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
                console.log('🔍 TEST 6: Firestore verification')
                console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
                
                const attDocId = `${newSessionId}_${studentUid}`
                const attDoc = await db.collection('attendance').doc(attDocId).get()
                if (attDoc.exists) {
                    const attData = attDoc.data()
                    console.log('   ✅ Attendance document found:', attDocId)
                    console.log('   networkVerified:', attData.networkVerified)
                    console.log('   studentSSID:', attData.studentSSID)
                    console.log('   method:', attData.method)
                    console.log('   status:', attData.status)
                } else {
                    console.log('   ⚠️  Attendance doc not found:', attDocId)
                }
            }
        } else {
            // Session is active - run all tests with the existing session
            console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
            console.log('   ℹ️  No student available or session not found')
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
        }

        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
        console.log('🏁 ALL TESTS COMPLETE')
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

    } catch (err) {
        console.error('❌ Error:', err.message)
        console.error(err.stack)
    }
    process.exit(0)
}

run()

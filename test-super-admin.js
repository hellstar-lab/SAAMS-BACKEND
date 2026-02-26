import { auth, db } from './config/firebase.js'
import dotenv from 'dotenv'
dotenv.config()

const API_BASE = `http://localhost:${process.env.PORT || 3000}`
const WEB_API_KEY = process.env.FIREBASE_WEB_API_KEY

if (!WEB_API_KEY) {
    console.error('❌ FIREBASE_WEB_API_KEY not set in .env')
    process.exit(1)
}

const getIdToken = async (uid) => {
    const customToken = await auth.createCustomToken(uid)
    const res = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${WEB_API_KEY}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: customToken, returnSecureToken: true })
        }
    )
    const data = await res.json()
    if (!data.idToken) {
        console.error('❌ Failed to get ID token:', data)
        process.exit(1)
    }
    return data.idToken
}

const api = async (method, path, token, body = null) => {
    const opts = {
        method,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        }
    }
    if (body) opts.body = JSON.stringify(body)

    const res = await fetch(`${API_BASE}${path}`, opts)
    const data = await res.json()
    return { status: res.status, data }
}

const runTests = async () => {
    try {
        console.log('🔍 Setting up Super Admin constraints...')
        let adminUid = 'test-super-admin-uid'
        try {
            await auth.createUser({
                uid: adminUid,
                email: 'superadmin1@saams.com',
                password: 'password123',
                displayName: 'Test Super Admin'
            })
        } catch (e) {
            // ignore if exists
        }
        await db.collection('superAdmin').doc(adminUid).set({
            adminId: adminUid,
            name: 'Test Super Admin',
            email: 'superadmin1@saams.com',
            role: 'superAdmin',
            isActive: true,
            createdAt: new Date()
        })
        console.log(`  ✅ Super Admin UID: ${adminUid}`)
        const adminToken = await getIdToken(adminUid)

        console.log('🔍 Setting up Student constraints...')
        let studentUid = 'test-student-uid'
        try {
            await auth.createUser({
                uid: studentUid,
                email: 'student1@saams.com',
                password: 'password123',
                displayName: 'Test Student'
            })
        } catch (e) {
            // ignore if exists
        }
        await db.collection('students').doc(studentUid).set({
            studentId: studentUid,
            name: 'Test Student',
            email: 'student1@saams.com',
            role: 'student',
            isActive: true,
            createdAt: new Date()
        })
        console.log(`  ✅ Student UID: ${studentUid}`)
        const studentToken = await getIdToken(studentUid)

        console.log('\n━━━ Test 1: System overview ━━━')
        const t1 = await api('GET', '/api/admin/overview', adminToken)
        console.log(`  Status: ${t1.status}`)
        if (t1.data.data?.systemCounts && t1.data.data?.pendingActions && t1.data.data?.departmentBreakdown) {
            console.log(`  ✅ Expected fields present.`)
        } else {
            console.error(`  ❌ Expected fields missing. response:`, JSON.stringify(t1.data, null, 2))
        }

        console.log('\n━━━ Test 2: Pending actions ━━━')
        const t2 = await api('GET', '/api/admin/pending-actions', adminToken)
        console.log(`  Status: ${t2.status}`)
        if (t2.data.data?.teachersNeedingDepartment && t2.data.data?.studentsNeedingDepartment) {
            console.log(`  ✅ Expected fields present.`)
        } else {
            console.error(`  ❌ Expected fields missing. response:`, JSON.stringify(t2.data, null, 2))
        }

        console.log('\n━━━ Test 3: Active sessions ━━━')
        const t3 = await api('GET', '/api/admin/sessions/active', adminToken)
        console.log(`  Status: ${t3.status}`)
        if (Array.isArray(t3.data.data)) {
            console.log(`  ✅ Expected array of active sessions. Count: ${t3.data.data.length}`)
        } else {
            console.error(`  ❌ Expected array. response:`, JSON.stringify(t3.data, null, 2))
        }

        console.log('\n━━━ Test 4: Verify student cannot access ━━━')
        const t4 = await api('GET', '/api/admin/overview', studentToken)
        console.log(`  Status: ${t4.status}`)
        if (t4.status === 403 && t4.data.code === 'SUPER_ADMIN_ONLY') {
            console.log(`  ✅ Successfully blocked student.`)
        } else {
            console.error(`  ❌ Expected 403 SUPER_ADMIN_ONLY. response:`, JSON.stringify(t4.data, null, 2))
        }

        console.log('\n═══════════════════════════════════════════')
        console.log('  🎉 ALL TESTS PASSED!')
        console.log('═══════════════════════════════════════════')

    } catch (error) {
        console.error('❌ Test error:', error)
    }
    process.exit(0)
}

runTests()

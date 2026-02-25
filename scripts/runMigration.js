import { admin, db } from '../config/firebase.js'

async function runMigration() {
    console.log('🚀 Starting Database Migration Script...\n')

    const summary = {
        students: 0,
        teachers: 0,
        classes: 0,
        sessions: 0,
        attendance: 0
    }

    try {
        // ============================================
        // 1. MIGRATE STUDENTS
        // ============================================
        console.log('Fetching students...')
        const studentsSnapshot = await db.collection('students').get()
        console.log(`Updating ${studentsSnapshot.size} documents in students...`)

        let currentBatch = db.batch()
        let batchCount = 0

        for (const doc of studentsSnapshot.docs) {
            const data = doc.data()
            const updates = {}

            if (data.semester === undefined) updates.semester = null
            if (data.branch === undefined) updates.branch = null
            if (data.department === undefined) updates.department = null
            if (data.fcmToken === undefined) updates.fcmToken = null
            if (data.profilePhotoUrl === undefined) updates.profilePhotoUrl = null
            if (data.isActive === undefined) updates.isActive = true
            if (data.lastLoginAt === undefined) updates.lastLoginAt = null
            if (data.faceRegistered === undefined) {
                updates.faceRegistered = Array.isArray(data.faceDescriptor) ? true : false
            }

            if (Object.keys(updates).length > 0) {
                updates.updatedAt = admin.firestore.FieldValue.serverTimestamp()
                currentBatch.update(doc.ref, updates)
                batchCount++
                summary.students++

                if (batchCount === 500) {
                    await currentBatch.commit()
                    currentBatch = db.batch()
                    batchCount = 0
                }
            }
        }

        if (batchCount > 0) await currentBatch.commit()
        console.log(`✅ Done: ${summary.students} students updated.\n`)


        // ============================================
        // 2. MIGRATE TEACHERS
        // ============================================
        console.log('Fetching teachers...')
        const teachersSnapshot = await db.collection('teachers').get()
        console.log(`Updating ${teachersSnapshot.size} documents in teachers...`)

        currentBatch = db.batch()
        batchCount = 0

        for (const doc of teachersSnapshot.docs) {
            const data = doc.data()
            const updates = {}

            if (data.fcmToken === undefined) updates.fcmToken = null
            if (data.profilePhotoUrl === undefined) updates.profilePhotoUrl = null
            if (data.isActive === undefined) updates.isActive = true
            if (data.lastLoginAt === undefined) updates.lastLoginAt = null

            if (Object.keys(updates).length > 0) {
                updates.updatedAt = admin.firestore.FieldValue.serverTimestamp()
                currentBatch.update(doc.ref, updates)
                batchCount++
                summary.teachers++

                if (batchCount === 500) {
                    await currentBatch.commit()
                    currentBatch = db.batch()
                    batchCount = 0
                }
            }
        }

        if (batchCount > 0) await currentBatch.commit()
        console.log(`✅ Done: ${summary.teachers} teachers updated.\n`)


        // ============================================
        // 3. MIGRATE CLASSES
        // ============================================
        console.log('Fetching classes...')
        const classesSnapshot = await db.collection('classes').get()
        console.log(`Updating ${classesSnapshot.size} documents in classes...`)

        currentBatch = db.batch()
        batchCount = 0

        for (const doc of classesSnapshot.docs) {
            const data = doc.data()
            const updates = {}

            if (data.semester === undefined) updates.semester = null
            if (data.academicYear === undefined) updates.academicYear = '2024-25'
            if (data.totalSessions === undefined) updates.totalSessions = 0
            if (data.isActive === undefined) updates.isActive = true

            if (Object.keys(updates).length > 0) {
                updates.updatedAt = admin.firestore.FieldValue.serverTimestamp()
                currentBatch.update(doc.ref, updates)
                batchCount++
                summary.classes++

                if (batchCount === 500) {
                    await currentBatch.commit()
                    currentBatch = db.batch()
                    batchCount = 0
                }
            }
        }

        if (batchCount > 0) await currentBatch.commit()
        console.log(`✅ Done: ${summary.classes} classes updated.\n`)


        // ============================================
        // 4. MIGRATE SESSIONS
        // ============================================
        console.log('Fetching sessions...')
        const sessionsSnapshot = await db.collection('sessions').get()
        console.log(`Updating ${sessionsSnapshot.size} documents in sessions...`)

        currentBatch = db.batch()
        batchCount = 0

        for (const doc of sessionsSnapshot.docs) {
            const data = doc.data()
            const updates = {}

            if (data.autoAbsentMinutes === undefined) updates.autoAbsentMinutes = 5
            if (data.totalStudents === undefined) updates.totalStudents = 0
            if (data.subjectName === undefined) updates.subjectName = 'Unknown Subject'
            if (data.qrRefreshInterval === undefined) updates.qrRefreshInterval = (data.method === 'qrcode') ? 30 : null
            if (data.qrLastRefreshed === undefined) updates.qrLastRefreshed = null
            if (data.radiusMeters === undefined) updates.radiusMeters = (data.method === 'gps') ? 50 : null
            if (data.bleSessionCode === undefined) updates.bleSessionCode = null
            if (data.expectedSSID === undefined) updates.expectedSSID = null
            if (data.endTime === undefined) updates.endTime = null

            if (Object.keys(updates).length > 0) {
                currentBatch.update(doc.ref, updates)
                batchCount++
                summary.sessions++

                if (batchCount === 500) {
                    await currentBatch.commit()
                    currentBatch = db.batch()
                    batchCount = 0
                }
            }
        }

        if (batchCount > 0) await currentBatch.commit()
        console.log(`✅ Done: ${summary.sessions} sessions updated.\n`)


        // ============================================
        // 5. MIGRATE ATTENDANCE
        // ============================================
        console.log('Fetching attendance...')
        const attendanceSnapshot = await db.collection('attendance').get()
        console.log(`Updating ${attendanceSnapshot.size} documents in attendance (Processing sequentially)...`)

        for (const doc of attendanceSnapshot.docs) {
            const data = doc.data()
            const updates = {}

            // 1 & 2: Data fetching if missing corresponding fields
            const needsStudentFetch = (data.studentName === undefined || data.studentCollegeId === undefined)
            const needsSessionFetch = (data.classId === undefined || data.teacherId === undefined)

            let studentData = null
            let sessionData = null

            if (needsStudentFetch && data.studentId) {
                const studentDoc = await db.collection('students').doc(data.studentId).get()
                if (studentDoc.exists) studentData = studentDoc.data()
            }

            if (needsSessionFetch && data.sessionId) {
                const sessionDoc = await db.collection('sessions').doc(data.sessionId).get()
                if (sessionDoc.exists) sessionData = sessionDoc.data()
            }

            // Populate updates dictionary based on fetched data or defaults
            if (data.studentName === undefined) updates.studentName = studentData?.name || 'Unknown Student'
            if (data.studentCollegeId === undefined) updates.studentCollegeId = studentData?.studentId || 'Unknown ID'

            if (data.classId === undefined) updates.classId = sessionData?.classId || 'Unknown Class'
            if (data.teacherId === undefined) updates.teacherId = sessionData?.teacherId || 'Unknown Teacher'

            if (data.teacherApproved === undefined) {
                if (data.status === 'late') updates.teacherApproved = null
                else if (data.status === 'present') updates.teacherApproved = true
                else if (data.status === 'absent') updates.teacherApproved = false
                else updates.teacherApproved = null
            }

            if (data.approvedAt === undefined) updates.approvedAt = null
            if (data.autoAbsent === undefined) updates.autoAbsent = false
            if (data.faceScore === undefined) updates.faceScore = null

            if (data.joinedAt === undefined) updates.joinedAt = data.createdAt || null
            if (data.markedAt === undefined) updates.markedAt = data.createdAt || null

            if (data.studentLat === undefined) updates.studentLat = null
            if (data.studentLng === undefined) updates.studentLng = null
            if (data.distanceFromClass === undefined) updates.distanceFromClass = null
            if (data.networkSSID === undefined) updates.networkSSID = null
            if (data.bleRSSI === undefined) updates.bleRSSI = null

            if (Object.keys(updates).length > 0) {
                await doc.ref.update(updates)
                summary.attendance++

                // Minor console log to not overflow stdout, print every 50 records
                if (summary.attendance % 50 === 0) {
                    console.log(`   ... processed ${summary.attendance} attendance updates ...`)
                }
            }
        }
        console.log(`✅ Done: ${summary.attendance} attendance documents updated.\n`)


        // ============================================
        // SUMMARY REPORT
        // ============================================
        console.log('============================================')
        console.log('🎉 MIGRATION COMPLETE: SUMMARY')
        console.log('============================================')
        console.log(`- Students updated:   ${summary.students}`)
        console.log(`- Teachers updated:   ${summary.teachers}`)
        console.log(`- Classes updated:    ${summary.classes}`)
        console.log(`- Sessions updated:   ${summary.sessions}`)
        console.log(`- Attendance updated: ${summary.attendance}`)
        console.log('============================================')

    } catch (error) {
        console.error('\n❌ FATAL ERROR DURING MIGRATION:', error.message)
        console.error(error.stack)
    }

    process.exit(0)
}

runMigration()

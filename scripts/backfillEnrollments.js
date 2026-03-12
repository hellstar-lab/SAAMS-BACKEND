/**
 * backfillEnrollments.js
 * One-time script to create enrollment documents for all existing class/student
 * relationships. Safe to run multiple times (uses merge: true).
 *
 * Usage:
 *   node scripts/backfillEnrollments.js
 */

import { db } from '../config/firebase.js'
import { FieldValue } from 'firebase-admin/firestore'

const backfillEnrollments = async () => {
    console.log('Starting enrollment backfill...')
    const classesSnap = await db.collection('classes').get()
    let written = 0
    let skipped = 0

    for (const classDoc of classesSnap.docs) {
        const cls = classDoc.data()
        const classId = classDoc.id
        const students = cls.students || []

        if (students.length === 0) {
            skipped++
            continue
        }

        // Firestore batch limit is 500 ops — chunk accordingly
        for (let i = 0; i < students.length; i += 500) {
            const chunk = students.slice(i, i + 500)
            const batch = db.batch()

            for (const studentId of chunk) {
                const enrollmentRef = db.collection('enrollments').doc(`${studentId}_${classId}`)
                batch.set(enrollmentRef, {
                    studentId,
                    classId,
                    enrolledAt: FieldValue.serverTimestamp(),
                    status: 'active',
                    teacherId: cls.teacherId || null,
                    subjectName: cls.subjectName || null,
                }, { merge: true })
            }

            await batch.commit()
            written += chunk.length
        }

        console.log(`Class ${classId} (${cls.subjectName || 'unknown'}): ${students.length} enrollment(s) written`)
    }

    console.log(`\nBackfill complete — classes: ${classesSnap.size}, enrollments written: ${written}, classes with no students: ${skipped}`)
    return { written, classes: classesSnap.size, skipped }
}

backfillEnrollments()
    .then(() => process.exit(0))
    .catch(err => {
        console.error('Backfill failed:', err)
        process.exit(1)
    })

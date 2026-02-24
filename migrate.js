/**
 * migrate.js — Migrates users from 'users' collection
 * into separate 'teachers' and 'students' collections.
 *
 * Run with: node migrate.js
 */

import { db } from './config/firebase.js'

const migrateUsers = async () => {
    console.log('🚀 Starting migration: users → teachers + students')

    const usersSnapshot = await db.collection('users').get()

    if (usersSnapshot.empty) {
        console.log('ℹ️  No documents found in users collection. Nothing to migrate.')
        process.exit(0)
    }

    let teacherCount = 0
    let studentCount = 0
    let skipped = 0

    for (const doc of usersSnapshot.docs) {
        const data = doc.data()

        if (data.role === 'teacher') {
            await db.collection('teachers').doc(doc.id).set({
                ...data,
                role: 'teacher',
                faceData: data.faceData || null
            })
            teacherCount++
            console.log(`  ✅ Teacher migrated: ${data.name} (${data.email})`)
        } else if (data.role === 'student') {
            await db.collection('students').doc(doc.id).set({
                ...data,
                role: 'student',
                faceData: data.faceData || null,
                enrolledClasses: data.enrolledClasses || []
            })
            studentCount++
            console.log(`  ✅ Student migrated: ${data.name} (${data.email})`)
        } else {
            console.log(`  ⚠️  Skipped unknown role: ${data.role} — ${data.email}`)
            skipped++
        }
    }

    console.log('\n══════════════════════════════')
    console.log('   Migration complete!')
    console.log(`   Teachers migrated: ${teacherCount}`)
    console.log(`   Students migrated: ${studentCount}`)
    console.log(`   Skipped: ${skipped}`)
    console.log('══════════════════════════════')
    console.log('\n⚠️  The old users collection still exists.')
    console.log('   Delete it manually from Firebase Console once verified.')
    process.exit(0)
}

migrateUsers().catch(err => {
    console.error('Migration failed:', err)
    process.exit(1)
})

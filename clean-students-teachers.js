import { db, auth } from './config/firebase.js'

async function deleteCollection(collectionPath) {
    const collectionRef = db.collection(collectionPath)
    let totalDeleted = 0

    while (true) {
        const snapshot = await collectionRef.limit(500).get()
        if (snapshot.size === 0) break

        const batch = db.batch()
        snapshot.docs.forEach(doc => batch.delete(doc.ref))
        await batch.commit()
        totalDeleted += snapshot.size
    }

    return totalDeleted
}

async function clearStudentAndTeacherAuthUsers() {
    // Collect UIDs of users who are students or teachers from Firestore
    const uidsToDelete = new Set()

    const [studentsSnap, teachersSnap] = await Promise.all([
        db.collection('students').select().get(),
        db.collection('teachers').select().get()
    ])

    studentsSnap.docs.forEach(doc => {
        if (doc.id) uidsToDelete.add(doc.id)
    })
    teachersSnap.docs.forEach(doc => {
        if (doc.id) uidsToDelete.add(doc.id)
    })

    const uids = [...uidsToDelete]
    if (uids.length === 0) {
        console.log('No student/teacher auth users found to delete.')
        return 0
    }

    // Delete in batches of 100 (Firebase Auth limit)
    let totalDeleted = 0
    for (let i = 0; i < uids.length; i += 100) {
        const batch = uids.slice(i, i + 100)
        const result = await auth.deleteUsers(batch)
        totalDeleted += result.successCount
        if (result.failureCount > 0) {
            result.errors.forEach(err => {
                console.warn(`  Warning: Could not delete UID ${err.index}: ${err.error.message}`)
            })
        }
    }
    return totalDeleted
}

async function run() {
    console.log('Starting cleanup of students and teachers...\n')

    // 1. Delete Firestore collections: students, teachers, users (student/teacher entries)
    const collectionsToClean = ['students', 'teachers']

    for (const col of collectionsToClean) {
        try {
            const count = await deleteCollection(col)
            console.log(`Cleared '${col}' collection: ${count} documents deleted`)
        } catch (e) {
            console.error(`Error clearing '${col}':`, e.message)
        }
    }

    // 2. Also clean up student/teacher entries from 'users' collection
    try {
        const usersRef = db.collection('users')
        let totalDeleted = 0

        while (true) {
            const snapshot = await usersRef
                .where('role', 'in', ['student', 'teacher'])
                .limit(500)
                .get()

            if (snapshot.size === 0) break

            const batch = db.batch()
            snapshot.docs.forEach(doc => batch.delete(doc.ref))
            await batch.commit()
            totalDeleted += snapshot.size
        }

        console.log(`Cleared student/teacher entries from 'users' collection: ${totalDeleted} documents deleted`)
    } catch (e) {
        console.error(`Error clearing student/teacher users:`, e.message)
    }

    // 3. Delete corresponding Firebase Auth accounts
    try {
        const authDeleted = await clearStudentAndTeacherAuthUsers()
        console.log(`Deleted ${authDeleted} student/teacher accounts from Firebase Auth`)
    } catch (e) {
        console.error('Error deleting Auth users:', e.message)
    }

    console.log('\nCleanup complete! Students and teachers have been removed.')
    process.exit(0)
}

run()

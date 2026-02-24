import { db, auth } from './config/firebase.js'

async function clearAuthUsers() {
    let result = await auth.listUsers(1000)
    let users = result.users
    let totalDeleted = 0

    while (users.length > 0) {
        const uids = users.map(u => u.uid)
        await auth.deleteUsers(uids)
        totalDeleted += uids.length

        if (result.pageToken) {
            result = await auth.listUsers(1000, result.pageToken)
            users = result.users
        } else {
            break
        }
    }
    if (totalDeleted > 0) {
        console.log(`Deleted ${totalDeleted} users from Firebase Auth`)
    }
}

async function deleteCollection(collectionPath) {
    const collectionRef = db.collection(collectionPath)
    const query = collectionRef.limit(500)

    return new Promise((resolve, reject) => {
        deleteQueryBatch(query, resolve).catch(reject)
    })
}

async function deleteQueryBatch(query, resolve) {
    const snapshot = await query.get()
    if (snapshot.size === 0) {
        resolve()
        return
    }
    const batch = db.batch()
    snapshot.docs.forEach((doc) => {
        batch.delete(doc.ref)
    })
    await batch.commit()
    process.nextTick(() => {
        deleteQueryBatch(query, resolve)
    })
}

async function run() {
    console.log('🚀 Starting full database wipe...')

    try {
        await clearAuthUsers()
        console.log('✅ Firebase Auth completely cleared.')
    } catch (e) {
        console.error('❌ Error clearing Auth:', e.message)
    }

    const collections = ['users', 'teachers', 'students', 'classes', 'sessions', 'attendance']
    for (const col of collections) {
        try {
            await deleteCollection(col)
            console.log(`✅ Collection cleared: ${col}`)
        } catch (e) {
            console.error(`❌ Error clearing ${col}:`, e.message)
        }
    }

    console.log('\n✨ Database is now completely empty and ready for fresh testing!')
    process.exit(0)
}

run()

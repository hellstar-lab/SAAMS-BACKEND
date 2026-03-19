import { db } from './config/firebase.js'

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

async function run() {
    console.log('Starting cleanup of classes and sessions...\n')

    const collectionsToClean = ['classes', 'sessions']

    for (const col of collectionsToClean) {
        try {
            const count = await deleteCollection(col)
            console.log(`Cleared '${col}' collection: ${count} documents deleted`)
        } catch (e) {
            console.error(`Error clearing '${col}':`, e.message)
        }
    }

    console.log('\nCleanup complete! Classes and sessions have been removed.')
    process.exit(0)
}

run()

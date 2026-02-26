import { admin, db } from './config/firebase.js'

async function checkDatabase() {
    console.log('🔍 Checking Firestore for enrolled faces...\n')

    try {
        const studentsRef = db.collection('students')
        // Get all students to check who has a faceDescriptor
        const snapshot = await studentsRef.get()

        let foundEnrolled = 0

        snapshot.forEach(doc => {
            const data = doc.data()
            if (data.faceDescriptor && Array.isArray(data.faceDescriptor)) {
                foundEnrolled++
                console.log(`✅ Student Found: ${data.name || 'Unknown Name'} (UID: ${doc.id})`)
                console.log(`   - Student ID: ${data.studentId || 'N/A'}`)
                console.log(`   - Face Descriptor Length: ${data.faceDescriptor.length} floats`)
                console.log(`   - Enrolled At: ${data.faceEnrolledAt || 'Unknown Date'}\n`)
            }
        })

        if (foundEnrolled === 0) {
            console.log('❌ No students found with an enrolled faceDescriptor.')
        } else {
            console.log(`🎉 Total faces enrolled: ${foundEnrolled}`)
        }

    } catch (error) {
        console.error('Error querying database:', error)
    }

    process.exit(0)
}

checkDatabase()

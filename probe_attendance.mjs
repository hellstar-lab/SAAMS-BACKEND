import { db } from './config/firebase.js'

const STUDENT_ID = 'Dgf7SUG9zqR7cH0gPs5eWDoUbsG3'
const CLASS_ID   = 'FLdBwnA3MkK2nK8lvZbS'

console.log('\n=== ATTENDANCE PROBE ===\n')

// 1. Exact query getStudentDashboard now runs
console.log('Query 1: studentId ==', STUDENT_ID, '&& classId ==', CLASS_ID)
const snap1 = await db.collection('attendance')
    .where('studentId', '==', STUDENT_ID)
    .where('classId', '==', CLASS_ID)
    .get()
console.log('  count:', snap1.size)
snap1.docs.forEach((doc, i) => {
    const d = doc.data()
    console.log(`  [${i}] id=${doc.id} status=${d.status}`)
})

// 2. Only studentId filter — check if the field is set at all
console.log('\nQuery 2: studentId ==', STUDENT_ID, '(no classId)')
const snap2 = await db.collection('attendance')
    .where('studentId', '==', STUDENT_ID)
    .get()
console.log('  count:', snap2.size)
snap2.docs.forEach((doc, i) => {
    const d = doc.data()
    console.log(`  [${i}] studentId=${d.studentId} | classId=${d.classId} | status=${d.status}`)
})

// 3. Fetch one known doc and print ALL its field names + values
const KNOWN = 'pQhOYBVJC8k1eVSYVGWg_Dgf7SUG9zqR7cH0gPs5eWDoUbsG3'
console.log('\nDirect doc:', KNOWN)
const single = await db.collection('attendance').doc(KNOWN).get()
if (single.exists) {
    const d = single.data()
    console.log('  exists: true')
    console.log('  studentId :', JSON.stringify(d.studentId))
    console.log('  classId   :', JSON.stringify(d.classId))
    console.log('  status    :', JSON.stringify(d.status))
} else {
    console.log('  NOT FOUND')
}

process.exit(0)

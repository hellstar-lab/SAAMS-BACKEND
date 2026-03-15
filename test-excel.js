import fs from 'fs';
import { generateSessionExcel } from './utils/excelGenerator.js';
import admin from 'firebase-admin';

async function run() {
    // 1. Mock Session Data
    const sessionData = {
        id: 'session_123',
        sessionId: 'session_123',
        subjectName: 'Computer Networks',
        subjectCode: 'CS401',
        method: 'gps',
        startTime: new Date('2026-03-12T09:00:00Z'),
        endTime: new Date('2026-03-12T10:00:00Z'),
        roomNumber: 'Room 304',
        buildingName: 'Tech Block',
        teacherName: 'Dr. Smith',
        totalStudents: 5,
        lateAfterMinutes: 10,
        autoAbsentMinutes: 30
    };

    // 2. Mock Class Data
    const classData = {
        subjectName: 'Computer Networks',
        subjectCode: 'CS401',
        departmentName: 'Computer Science',
        semester: '4',
        section: 'A',
        batch: '2024-2028',
        teacherName: 'Dr. Smith',
        minAttendance: 75
    };

    // 3. Mock Teacher Data
    const teacherData = {
        name: 'Dr. Smith',
        employeeId: 'EMP9921',
        designation: 'Associate Professor',
        departmentName: 'Computer Science'
    };

    // 4. Mock Attendance List (Testing the bug fix)
    const attendanceList = [
        {
            studentName: 'Alice Johnson',
            studentRollNumber: '22CS001',
            status: 'present',
            joinedAt: new Date('2026-03-12T09:02:00Z'), // On time
            method: 'gps',
            distance: 12.5,
            teacherApproved: null
        },
        {
            studentName: 'Bob Smith',
            studentRollNumber: '22CS002',
            status: 'late',
            joinedAt: new Date('2026-03-12T09:15:00Z'), // 15 mins late
            method: 'gps',
            distance: 8.2,
            teacherApproved: true // <--- APPROVED LATE (Should be PRESENT)
        },
        {
            studentName: 'Charlie Brown',
            studentRollNumber: '22CS003',
            status: 'late',
            joinedAt: new Date('2026-03-12T09:12:00Z'), // 12 mins late
            method: 'gps',
            distance: 5.1,
            teacherApproved: null // <--- PENDING LATE (Should be LATE)
        },
        {
            studentName: 'Diana Prince',
            studentRollNumber: '22CS004',
            status: 'late',
            joinedAt: new Date('2026-03-12T09:25:00Z'), // 25 mins late
            method: 'gps',
            distance: 15.0,
            teacherApproved: false // <--- REJECTED LATE (Should be ABSENT)
        },
        {
            studentName: 'Evan Wright',
            studentRollNumber: '22CS005',
            status: 'absent',
            joinedAt: null,
            method: 'gps',
            distance: null,
            autoAbsent: true,
            teacherApproved: null
        }
    ];

    try {
        console.log("Generating dummy report...");
        const buffer = await generateSessionExcel(sessionData, classData, teacherData, attendanceList);
        fs.writeFileSync('sample_report.xlsx', buffer);
        console.log("Successfully created sample_report.xlsx !");
        
        // Print out the expected math
        console.log("\n--- EXPECTED REPORT MATH ---");
        console.log("Total Students: 5");
        console.log("Present   (2) : Alice (present), Bob (late+approved)");
        console.log("Late      (1) : Charlie (late+pending)");
        console.log("Absent    (2) : Diana (late+rejected), Evan (absent)");
        console.log("Percentage: (2 / 5) * 100 = 40.0%");
        console.log("----------------------------\n");

    } catch (error) {
        console.error("Error generating excel:", error);
    }
}

run();

import XLSX from 'xlsx'

/**
 * Generates a 3-sheet attendance Excel report.
 * Sheet 1: Summary  |  Sheet 2: Student Report  |  Sheet 3: Session Log
 * Returns base64-encoded .xlsx string.
 */
export const generateAttendanceExcel = (data) => {
    const { className, subjectCode, semester, dateRange, sessions, students } = data

    const wb = XLSX.utils.book_new()

    // ─── Sheet 1: Summary ────────────────────────────────────────────────────────
    const avgAttendance = students.length > 0
        ? Math.round(students.reduce((s, st) => s + st.percentage, 0) / students.length)
        : 0

    const summaryData = [
        ['SAAM Smart Attendance Report'],
        [],
        ['Class:', className],
        ['Subject Code:', subjectCode],
        ['Semester:', `Semester ${semester}`],
        ['Period:', dateRange],
        ['Total Sessions:', sessions.length],
        ['Total Students:', students.length],
        ['Generated:', new Date().toLocaleString('en-IN')],
        [],
        ['Average Attendance:', avgAttendance + '%']
    ]
    const ws1 = XLSX.utils.aoa_to_sheet(summaryData)
    ws1['!cols'] = [{ wch: 20 }, { wch: 30 }]
    XLSX.utils.book_append_sheet(wb, ws1, 'Summary')

    // ─── Sheet 2: Student Report ─────────────────────────────────────────────────
    const studentHeaders = [
        'Student Name', 'Student ID', 'Present', 'Late', 'Absent',
        'Face Failed', 'Manual Approved', 'Total Sessions', 'Attendance %'
    ]
    const studentRows = students.map(s => [
        s.name,
        s.studentId,
        s.present,
        s.late,
        s.absent,
        s.faceFailed || 0,
        s.manualApproved || 0,
        s.total,
        s.percentage + '%'
    ])
    const ws2 = XLSX.utils.aoa_to_sheet([studentHeaders, ...studentRows])
    ws2['!cols'] = [
        { wch: 25 }, { wch: 12 }, { wch: 10 }, { wch: 8 }, { wch: 10 },
        { wch: 12 }, { wch: 16 }, { wch: 15 }, { wch: 14 }
    ]
    XLSX.utils.book_append_sheet(wb, ws2, 'Student Report')

    // ─── Sheet 3: Session Log ─────────────────────────────────────────────────────
    const sessionHeaders = [
        'Date', 'Start Time', 'End Time', 'Duration', 'Method',
        'Present', 'Late', 'Absent', 'Total', 'Attendance %'
    ]
    const sessionRows = sessions.map(s => {
        const totalMarked = (s.totalPresent || 0) + (s.totalLate || 0) + (s.totalAbsent || 0)
        return [
            new Date(s.startTime).toLocaleDateString('en-IN'),
            new Date(s.startTime).toLocaleTimeString('en-IN'),
            s.endTime ? new Date(s.endTime).toLocaleTimeString('en-IN') : 'N/A',
            s.duration || 'N/A',
            s.method.toUpperCase(),
            s.totalPresent || 0,
            s.totalLate || 0,
            s.totalAbsent || 0,
            totalMarked,
            s.attendanceRate ? s.attendanceRate + '%' : 'N/A'
        ]
    })
    const ws3 = XLSX.utils.aoa_to_sheet([sessionHeaders, ...sessionRows])
    ws3['!cols'] = [
        { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 12 },
        { wch: 10 }, { wch: 8 }, { wch: 10 }, { wch: 8 }, { wch: 14 }
    ]
    XLSX.utils.book_append_sheet(wb, ws3, 'Session Log')

    return XLSX.write(wb, { type: 'base64', bookType: 'xlsx' })
}

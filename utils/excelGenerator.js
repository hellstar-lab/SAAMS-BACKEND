import ExcelJS from 'exceljs';

const COLORS = {
  headerBg: '1F3864',
  headerText: 'FFFFFF',
  presentBg: 'E8F5E9',
  presentText: '2E7D32',
  absentBg: 'FFEBEE',
  absentText: 'C62828',
  lateBg: 'FFF8E1',
  lateText: 'F57F17',
  belowThresholdBg: 'FFCDD2',
  belowThresholdText: 'B71C1C',
  subheaderBg: 'C5CAE9',
  altRowBg: 'F5F5F5',
  borderColor: 'BDBDBD'
};

const formatDate = (timestamp) => {
    if (!timestamp) return 'N/A';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    if (isNaN(date.getTime())) return 'N/A';
    return date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const formatTime = (timestamp) => {
    if (!timestamp) return 'N/A';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    if (isNaN(date.getTime())) return 'N/A';
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
};

const formatMethod = (method) => {
    if (!method) return 'N/A';
    const map = {
        'qrcode': 'QR Code',
        'gps': 'GPS Location',
        'network': 'WiFi Network',
        'bluetooth': 'Bluetooth'
    };
    return map[method.toLowerCase()] || method.toUpperCase();
};

const setHeaderStyle = (row) => {
    row.eachCell((cell) => {
        cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: COLORS.headerBg }
        };
        cell.font = {
            color: { argb: COLORS.headerText },
            bold: true
        };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        cell.border = {
            top: { style: 'thin', color: { argb: COLORS.borderColor } },
            left: { style: 'thin', color: { argb: COLORS.borderColor } },
            bottom: { style: 'thin', color: { argb: COLORS.borderColor } },
            right: { style: 'thin', color: { argb: COLORS.borderColor } }
        };
    });
};

export const generateAttendanceExcel = (data) => {
    // Keeping the original function around just in case it's used somewhere else not specified
    // although the task implies changing the whole file. It was explicitly stated: "Keep ALL existing functions."
    import('xlsx').then(XLSX => {
        const { className, subjectCode, semester, dateRange, sessions, students } = data;
        const wb = XLSX.utils.book_new();

        const avgAttendance = students.length > 0
            ? Math.round(students.reduce((s, st) => s + st.percentage, 0) / students.length)
            : 0;

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
        ];
        const ws1 = XLSX.utils.aoa_to_sheet(summaryData);
        ws1['!cols'] = [{ wch: 20 }, { wch: 30 }];
        XLSX.utils.book_append_sheet(wb, ws1, 'Summary');

        const studentHeaders = [
            'Student Name', 'Student ID', 'Present', 'Late', 'Absent',
            'Face Failed', 'Manual Approved', 'Total Sessions', 'Attendance %'
        ];
        const studentRows = students.map(s => [
            s.name, s.studentId, s.present, s.late, s.absent,
            s.faceFailed || 0, s.manualApproved || 0, s.total, s.percentage + '%'
        ]);
        const ws2 = XLSX.utils.aoa_to_sheet([studentHeaders, ...studentRows]);
        ws2['!cols'] = [
            { wch: 25 }, { wch: 12 }, { wch: 10 }, { wch: 8 }, { wch: 10 },
            { wch: 12 }, { wch: 16 }, { wch: 15 }, { wch: 14 }
        ];
        XLSX.utils.book_append_sheet(wb, ws2, 'Student Report');

        const sessionHeaders = [
            'Date', 'Start Time', 'End Time', 'Duration', 'Method',
            'Present', 'Late', 'Absent', 'Total', 'Attendance %'
        ];
        const sessionRows = sessions.map(s => {
            const totalMarked = (s.totalPresent || 0) + (s.totalLate || 0) + (s.totalAbsent || 0);
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
            ];
        });
        const ws3 = XLSX.utils.aoa_to_sheet([sessionHeaders, ...sessionRows]);
        ws3['!cols'] = [
            { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 12 },
            { wch: 10 }, { wch: 8 }, { wch: 10 }, { wch: 8 }, { wch: 14 }
        ];
        XLSX.utils.book_append_sheet(wb, ws3, 'Session Log');

        return XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
    }).catch(console.error);
};

export async function generateClassAttendanceExcel(
    classInfo,
    summaries,
    sessions,
    attendanceRecords
) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'SAAMS';
    workbook.created = new Date();

    // =============== SHEET 1: Summary ===============
    const ws1 = workbook.addWorksheet('Summary', {
        pageSetup: { orientation: 'landscape', printArea: 'A1:I1000' }
    });

    ws1.columns = [
        { header: '', key: 'sno', width: 6 },
        { header: '', key: 'rollNo', width: 14 },
        { header: '', key: 'studentName', width: 25 },
        { header: '', key: 'present', width: 10 },
        { header: '', key: 'late', width: 12 },
        { header: '', key: 'absent', width: 10 },
        { header: '', key: 'totalSessions', width: 15 },
        { header: '', key: 'percentage', width: 14 },
        { header: '', key: 'status', width: 15 }
    ];

    const r1 = ws1.addRow(['SAAMS — Attendance Summary Report']);
    r1.height = 25;
    ws1.mergeCells('A1:I1');
    ws1.getCell('A1').font = { size: 16, bold: true };
    ws1.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };

    const r2 = ws1.addRow([`${classInfo.subjectName} (${classInfo.subjectCode}) | Sem ${classInfo.semester} | Section ${classInfo.section} | ${classInfo.batch} | ${classInfo.academicYear}`]);
    ws1.mergeCells('A2:I2');
    ws1.getCell('A2').alignment = { horizontal: 'center' };

    const r3 = ws1.addRow([`Teacher: ${classInfo.teacherName}`]);
    ws1.mergeCells('A3:I3');
    ws1.getCell('A3').alignment = { horizontal: 'center' };

    const r4 = ws1.addRow([`Department: ${classInfo.departmentName}`]);
    ws1.mergeCells('A4:I4');
    ws1.getCell('A4').alignment = { horizontal: 'center' };

    const r5 = ws1.addRow([`Generated: ${new Date().toLocaleString()}`]);
    ws1.mergeCells('A5:I5');
    ws1.getCell('A5').alignment = { horizontal: 'center' };

    const r6 = ws1.addRow([`Minimum Required: ${classInfo.minAttendance}%`]);
    ws1.mergeCells('A6:I6');
    ws1.getCell('A6').alignment = { horizontal: 'center' };

    ws1.addRow([]); // Row 7 Blank

    const headerRow1 = ws1.addRow([
        'S.No', 'Roll Number', 'Student Name', 'Present', 'Late (Approved)',
        'Absent', 'Total Sessions', 'Attendance %', 'Status'
    ]);
    setHeaderStyle(headerRow1);
    ws1.autoFilter = 'A8:I8';
    ws1.views = [{ state: 'frozen', xSplit: 0, ySplit: 8 }];

    if (!summaries || summaries.length === 0) {
        ws1.addRow(['No data available']);
    } else {
        const sortedSummaries = [...summaries].sort((a, b) => (a.studentRollNumber || '').localeCompare(b.studentRollNumber || ''));
        
        let totalPresentSum = 0;
        let belowThresholdCount = 0;

        sortedSummaries.forEach((summary, index) => {
            const rowData = [
                index + 1,
                summary.studentRollNumber,
                summary.studentName,
                summary.present,
                summary.late,
                summary.absent,
                summary.totalSessions,
                `${summary.percentage}%`,
                summary.isBelowThreshold ? 'AT RISK ⚠' : 'SAFE ✓'
            ];
            const row = ws1.addRow(rowData);
            row.alignment = { vertical: 'middle', horizontal: 'center' };
            row.getCell(3).alignment = { horizontal: 'left' }; // Left align name

            if (summary.isBelowThreshold) {
                row.eachCell(c => c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.belowThresholdBg } });
                row.getCell(9).font = { color: { argb: COLORS.belowThresholdText }, bold: true };
            } else if (summary.percentage >= 90) {
                row.eachCell(c => c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.presentBg } });
            } else if (index % 2 === 1) { // alt colors
                row.eachCell(c => c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.altRowBg } });
            }

            totalPresentSum += summary.percentage;
            if (summary.isBelowThreshold) belowThresholdCount++;
        });

        // Summary footer
        ws1.addRow([]);
        const avgPresent = (totalPresentSum / summaries.length).toFixed(1);
        ws1.addRow(['Total Students:', summaries.length]);
        ws1.addRow(['Present Average:', `${avgPresent}%`]);
        ws1.addRow(['Students At Risk:', belowThresholdCount]);
        ws1.addRow(['Sessions Conducted:', classInfo.totalSessions]);
    }

    // =============== SHEET 2: Session Details ===============
    const ws2 = workbook.addWorksheet('Session Details', {
        pageSetup: { orientation: 'landscape', printArea: 'A1:N1000' }
    });

    ws2.columns = [
        { header: '', key: 'sno', width: 6 },
        { header: '', key: 'date', width: 12 },
        { header: '', key: 'day', width: 10 },
        { header: '', key: 'subject', width: 20 },
        { header: '', key: 'method', width: 12 },
        { header: '', key: 'room', width: 10 },
        { header: '', key: 'startTime', width: 12 },
        { header: '', key: 'endTime', width: 12 },
        { header: '', key: 'duration', width: 10 },
        { header: '', key: 'present', width: 10 },
        { header: '', key: 'late', width: 8 },
        { header: '', key: 'absent', width: 10 },
        { header: '', key: 'total', width: 8 },
        { header: '', key: 'attendanceRate', width: 14 }
    ];

    ws2.mergeCells('A1:N1');
    const titleCell2 = ws2.getCell('A1');
    titleCell2.value = 'Session-wise Attendance Report';
    titleCell2.font = { size: 16, bold: true };
    titleCell2.alignment = { horizontal: 'center' };
    ws2.addRow([]);

    const headerRow2 = ws2.addRow([
        'S.No', 'Date', 'Day', 'Subject', 'Method', 'Room', 'Start Time',
        'End Time', 'Duration', 'Present', 'Late', 'Absent', 'Total', 'Attendance %'
    ]);
    setHeaderStyle(headerRow2);
    ws2.autoFilter = 'A3:N3';
    ws2.views = [{ state: 'frozen', xSplit: 0, ySplit: 3 }];

    if (!sessions || sessions.length === 0) {
        ws2.addRow(['No data available']);
    } else {
        const sortedSessions = [...sessions].sort((a, b) => {
            const dA = a.startTime?.toDate ? a.startTime.toDate() : new Date(a.startTime);
            const dB = b.startTime?.toDate ? b.startTime.toDate() : new Date(b.startTime);
            return dA - dB;
        });

        sortedSessions.forEach((session, index) => {
            const sessionRecords = attendanceRecords ? attendanceRecords.filter(r => r.sessionId === session.sessionId) : [];
            let presentCount = 0;
            let lateCount = 0;
            let absentCount = 0;

            sessionRecords.forEach(r => {
                if (r.status === 'present') presentCount++;
                else if (r.status === 'late') lateCount++;
                else if (r.status === 'absent') absentCount++;
            });

            const sDate = session.startTime?.toDate ? session.startTime.toDate() : new Date(session.startTime);
            const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
            const dayName = !isNaN(sDate.getTime()) ? days[sDate.getDay()] : 'N/A';

            let duration = 'N/A';
            if (session.endTime && !isNaN(sDate.getTime())) {
                const eDate = session.endTime.toDate ? session.endTime.toDate() : new Date(session.endTime);
                if (!isNaN(eDate.getTime())) {
                    const diffMins = Math.round((eDate - sDate) / 60000);
                    duration = `${diffMins} min`;
                }
            }

            const totalMarked = presentCount + lateCount + absentCount;
            const enrol = session.totalStudents || 1;
            const attRate = ((presentCount + lateCount) / enrol * 100).toFixed(1);

            const row = ws2.addRow([
                index + 1,
                formatDate(session.startTime),
                dayName,
                session.subjectName,
                formatMethod(session.method),
                session.roomNumber || 'N/A',
                formatTime(session.startTime),
                formatTime(session.endTime) || 'Ongoing',
                duration,
                presentCount,
                lateCount,
                absentCount,
                totalMarked,
                `${attRate}%`
            ]);
            row.alignment = { vertical: 'middle', horizontal: 'center' };
            if (index % 2 === 1) {
                row.eachCell(c => c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.altRowBg } });
            }
        });
    }

    // =============== SHEET 3: Raw Attendance Data ===============
    const ws3 = workbook.addWorksheet('Raw Attendance Data', {
        pageSetup: { orientation: 'landscape', printArea: 'A1:O1000' }
    });

    ws3.columns = [
        { header: '', key: 'sno', width: 6 },
        { header: '', key: 'date', width: 12 },
        { header: '', key: 'time', width: 10 },
        { header: '', key: 'rollNo', width: 14 },
        { header: '', key: 'studentName', width: 22 },
        { header: '', key: 'status', width: 12 },
        { header: '', key: 'method', width: 14 },
        { header: '', key: 'faceVerified', width: 14 },
        { header: '', key: 'faceScore', width: 12 },
        { header: '', key: 'lateMins', width: 12 },
        { header: '', key: 'distance', width: 12 },
        { header: '', key: 'network', width: 14 },
        { header: '', key: 'autoAbsent', width: 12 },
        { header: '', key: 'suspicious', width: 12 },
        { header: '', key: 'approved', width: 18 }
    ];

    ws3.mergeCells('A1:O1');
    const titleCell3 = ws3.getCell('A1');
    titleCell3.value = 'Detailed Attendance Records';
    titleCell3.font = { size: 16, bold: true };
    titleCell3.alignment = { horizontal: 'center' };
    ws3.addRow([]);

    const headerRow3 = ws3.addRow([
        'S.No', 'Date', 'Time', 'Roll Number', 'Student Name', 'Status', 'Method',
        'Face Verified', 'Face Score', 'Late (mins)', 'Distance (m)', 'Network SSID',
        'Auto Absent', 'Suspicious', 'Approved By Teacher'
    ]);
    setHeaderStyle(headerRow3);
    ws3.autoFilter = 'A3:O3';
    ws3.views = [{ state: 'frozen', xSplit: 0, ySplit: 3 }];

    if (!attendanceRecords || attendanceRecords.length === 0) {
        ws3.addRow(['No data available']);
    } else {
        const sortedRecords = [...attendanceRecords].sort((a, b) => {
            const dA = a.joinedAt?.toDate ? a.joinedAt.toDate() : new Date(a.joinedAt);
            const dB = b.joinedAt?.toDate ? b.joinedAt.toDate() : new Date(b.joinedAt);
            return dA - dB;
        });

        const sessionMap = {};
        if (sessions) {
            sessions.forEach(s => {
                sessionMap[s.sessionId] = s;
            });
        }

        sortedRecords.forEach((record, index) => {
            let sessionStart = null;
            if (sessionMap[record.sessionId] && sessionMap[record.sessionId].startTime) {
                sessionStart = sessionMap[record.sessionId].startTime.toDate ? sessionMap[record.sessionId].startTime.toDate() : new Date(sessionMap[record.sessionId].startTime);
            }
            
            let lateMins = 'N/A';
            if (record.joinedAt && sessionStart) {
                const jDate = record.joinedAt.toDate ? record.joinedAt.toDate() : new Date(record.joinedAt);
                if (!isNaN(jDate.getTime()) && !isNaN(sessionStart.getTime())) {
                    const diff = Math.round((jDate - sessionStart) / 60000);
                    lateMins = diff > 0 ? diff : 0;
                }
            }

            const faceScoreStr = record.faceScore ? (record.faceScore * 100).toFixed(1) + '%' : 'N/A';
            const distStr = record.distanceFromClass ? record.distanceFromClass.toFixed(1) + 'm' : 'N/A';
            
            let approvedStr = 'Pending...';
            if (record.teacherApproved === true) approvedStr = 'Approved ✓';
            else if (record.teacherApproved === false) approvedStr = 'Rejected ✗';

            const capStatus = record.status ? record.status.charAt(0).toUpperCase() + record.status.slice(1) : 'Unknown';

            const row = ws3.addRow([
                index + 1,
                formatDate(record.joinedAt),
                formatTime(record.joinedAt),
                record.studentRollNumber,
                record.studentName,
                capStatus,
                formatMethod(record.method),
                record.faceVerified ? 'Yes ✓' : 'No ✗',
                faceScoreStr,
                lateMins,
                distStr,
                record.networkSSID || 'N/A',
                record.autoAbsent ? 'Yes' : 'No',
                record.isSuspicious ? 'YES ⚠' : 'No',
                approvedStr
            ]);
            row.alignment = { vertical: 'middle', horizontal: 'center' };

            // row coloring
            if (record.isSuspicious) {
                row.eachCell(c => c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.belowThresholdBg } });
            } else if (record.status === 'present') {
                row.eachCell(c => c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.presentBg } });
            } else if (record.status === 'absent') {
                row.eachCell(c => c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.absentBg } });
            } else if (record.status === 'late' && record.teacherApproved === true) {
                row.eachCell(c => c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.lateBg } });
            } else if (index % 2 === 1) {
                row.eachCell(c => c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.altRowBg } });
            }
        });
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return buffer;
}


export async function generateDepartmentExcel(
    departmentName,
    academicYear,
    allSummaries,
    departmentStats
) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'SAAMS';
    workbook.created = new Date();

    // =============== SHEET 1: Department Overview ===============
    const ws1 = workbook.addWorksheet('Department Overview', {
        pageSetup: { orientation: 'landscape', printArea: 'A1:J1000' }
    });

    ws1.columns = [
        { header: '', key: 'rollNo', width: 14 },
        { header: '', key: 'name', width: 25 },
        { header: '', key: 'semester', width: 10 },
        { header: '', key: 'section', width: 10 },
        { header: '', key: 'present', width: 10 },
        { header: '', key: 'late', width: 10 },
        { header: '', key: 'absent', width: 10 },
        { header: '', key: 'total', width: 12 },
        { header: '', key: 'percentage', width: 12 },
        { header: '', key: 'status', width: 15 }
    ];

    const r1 = ws1.addRow(['SAAMS — Department Attendance Report']);
    r1.height = 25;
    ws1.mergeCells('A1:J1');
    ws1.getCell('A1').font = { size: 16, bold: true };
    ws1.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };

    const r2 = ws1.addRow([`Department: ${departmentName} | Academic Year: ${academicYear}`]);
    ws1.mergeCells('A2:J2');
    ws1.getCell('A2').alignment = { horizontal: 'center' };

    const r3 = ws1.addRow([`Generated: ${new Date().toLocaleString()}`]);
    ws1.mergeCells('A3:J3');
    ws1.getCell('A3').alignment = { horizontal: 'center' };

    ws1.addRow([]); // Row 4

    const statsText = `Average Attendance: ${departmentStats.averageAttendance}%  |  Students > 90%: ${departmentStats.studentsAbove90}  |  Students < 75%: ${departmentStats.studentsBelow75}  |  Total Tracked: ${departmentStats.totalStudents}`;
    const r5 = ws1.addRow(['', '', statsText]);
    r5.height = 25;
    ws1.mergeCells('C5:I5');
    ws1.getCell('C5').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.subheaderBg } };
    ws1.getCell('C5').alignment = { horizontal: 'center', vertical: 'middle' };
    ws1.getCell('C5').font = { bold: true };

    ws1.addRow([]); // Row 6

    const subjectsMap = {};
    if (allSummaries) {
        allSummaries.forEach(s => {
            if (!subjectsMap[s.subjectCode]) {
                subjectsMap[s.subjectCode] = { name: s.subjectName || s.subjectCode, records: [] };
            }
            subjectsMap[s.subjectCode].records.push(s);
        });
    }

    Object.keys(subjectsMap).forEach(subjCode => {
        const subjData = subjectsMap[subjCode];
        
        const subjHeader = ws1.addRow([`${subjData.name} (${subjCode})`]);
        ws1.mergeCells(`A${subjHeader.number}:J${subjHeader.number}`);
        subjHeader.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.headerBg } };
        subjHeader.getCell(1).font = { color: { argb: COLORS.headerText }, bold: true };
        subjHeader.getCell(1).alignment = { horizontal: 'center' };

        const colHeaders = ws1.addRow(['Roll No', 'Name', 'Semester', 'Section', 'Present', 'Late', 'Absent', 'Total Sessions', 'Percentage', 'Status']);
        colHeaders.eachCell(c => {
            c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.subheaderBg } };
            c.font = { bold: true };
            c.alignment = { horizontal: 'center' };
            c.border = { top: { style: 'thin', color: { argb: COLORS.borderColor } }, bottom: { style: 'thin', color: { argb: COLORS.borderColor } } };
        });

        subjData.records.sort((a,b) => (a.studentRollNumber || '').localeCompare(b.studentRollNumber || ''));
        subjData.records.forEach((rec, idx) => {
            const row = ws1.addRow([
                rec.studentRollNumber,
                rec.studentName,
                rec.semester,
                rec.section,
                rec.present,
                rec.late,
                rec.absent,
                rec.totalSessions,
                `${rec.percentage}%`,
                rec.isBelowThreshold ? 'AT RISK ⚠' : 'SAFE ✓'
            ]);
            row.alignment = { horizontal: 'center', vertical: 'middle' };
            row.getCell(2).alignment = { horizontal: 'left' };
            
            if (rec.isBelowThreshold) {
                row.getCell(10).font = { color: { argb: COLORS.belowThresholdText }, bold: true };
            }
            if (idx % 2 === 1) {
                row.eachCell(c => c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.altRowBg } });
            }
        });
        ws1.addRow([]); // spacer
    });

    // =============== SHEET 2: At Risk Students ===============
    const ws2 = workbook.addWorksheet('At Risk Students', {
        pageSetup: { orientation: 'landscape', printArea: 'A1:H1000' }
    });

    ws2.columns = [
        { header: '', key: 'rollNo', width: 14 },
        { header: '', key: 'name', width: 25 },
        { header: '', key: 'subject', width: 25 },
        { header: '', key: 'semester', width: 10 },
        { header: '', key: 'section', width: 10 },
        { header: '', key: 'percentage', width: 14 },
        { header: '', key: 'required', width: 12 },
        { header: '', key: 'shortfall', width: 12 }
    ];

    ws2.mergeCells('A1:H1');
    ws2.getCell('A1').value = 'Students Below Minimum Attendance';
    ws2.getCell('A1').font = { size: 16, bold: true };
    ws2.getCell('A1').alignment = { horizontal: 'center' };
    ws2.addRow([]);

    const headerRowAtRisk = ws2.addRow([
        'Roll Number', 'Student Name', 'Subject', 'Semester', 'Section', 'Attendance %', 'Required %', 'Shortfall'
    ]);
    setHeaderStyle(headerRowAtRisk);
    ws2.autoFilter = 'A3:H3';
    ws2.views = [{ state: 'frozen', xSplit: 0, ySplit: 3 }];

    let atRiskCount = 0;
    if (allSummaries) {
        const atRisk = allSummaries.filter(s => s.isBelowThreshold);
        atRisk.sort((a,b) => (a.studentRollNumber || '').localeCompare(b.studentRollNumber || ''));

        atRisk.forEach(rec => {
            const minAttr = rec.minAttendance || 75; // fallback
            const shortfall = minAttr - rec.percentage;
            const sfStr = `-${shortfall.toFixed(1)}%`;
            
            const row = ws2.addRow([
                rec.studentRollNumber,
                rec.studentName,
                `${rec.subjectName} (${rec.subjectCode})`,
                rec.semester,
                rec.section,
                `${rec.percentage}%`,
                `${minAttr}%`,
                sfStr
            ]);
            row.alignment = { horizontal: 'center', vertical: 'middle' };
            row.eachCell(c => c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.belowThresholdBg } });
            atRiskCount++;
        });
    }

    ws2.addRow([]);
    ws2.addRow([`Total At Risk Students: ${atRiskCount}`]);

    const buffer = await workbook.xlsx.writeBuffer();
    return buffer;
}

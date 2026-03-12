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

export async function generateSessionAttendanceExcel(session, records) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'SAAMS';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Session Report');

    // Title & Metadata
    sheet.addRow([`Attendance Report — ${session.subjectName || 'Subject'}`]);
    
    // Safely format date
    const sTime = session.startTime?.toDate ? session.startTime.toDate() : new Date(session.startTime);
    const dateStr = !isNaN(sTime.getTime()) ? sTime.toISOString().split('T')[0] : 'N/A';
    
    sheet.addRow([`Date: ${dateStr}`]);
    sheet.addRow([`Method: ${session.method || 'N/A'}`]);
    sheet.addRow([`Room: ${session.roomNumber || 'N/A'}`]);
    sheet.addRow([]);

    const headerRow = sheet.addRow(['Roll No', 'Student Name', 'Status', 'Time Joined', 'Minutes Late']);
    headerRow.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.headerBg } };
        cell.font = { color: { argb: COLORS.headerText }, bold: true };
        cell.alignment = { horizontal: 'center' };
    });

    sheet.getColumn(1).width = 15;
    sheet.getColumn(2).width = 25;
    sheet.getColumn(3).width = 15;
    sheet.getColumn(4).width = 25;
    sheet.getColumn(5).width = 15;

    let totalPresent = 0, totalLate = 0, totalAbsent = 0;

    records.forEach(r => {
        let statusText = r.status || 'unknown';
        let color = 'FFFFFFFF';
        let minutesLate = '';

        const sApproved = r.teacherApproved;
        if (r.status === 'present' || (r.status === 'late' && sApproved === true)) {
            totalPresent++;
            statusText = 'Present';
            color = COLORS.presentBg.substring(1); // ExcelJS uses ARGB hex (no #)
        } else if (r.status === 'late') {
            totalLate++;
            statusText = 'Late';
            color = COLORS.lateBg.substring(1);
            
            const jTime = r.joinedAt?.toDate ? r.joinedAt.toDate() : new Date(r.joinedAt);
            if (!isNaN(jTime.getTime()) && !isNaN(sTime.getTime())) {
                const mins = Math.floor((jTime.getTime() - sTime.getTime()) / 60000);
                minutesLate = mins > 0 ? mins : 0;
            }
        } else if (r.status === 'absent' || (r.status === 'late' && sApproved === false)) {
            totalAbsent++;
            statusText = 'Absent';
            color = COLORS.absentBg.substring(1);
        }

        const jTime = r.joinedAt?.toDate ? r.joinedAt.toDate() : new Date(r.joinedAt);
        const timeJoinedStr = !isNaN(jTime.getTime()) ? jTime.toLocaleString() : 'N/A';
        const rollNo = r.rollNumber || r.studentRollNumber || 'N/A';
        const name = r.studentName || 'N/A';

        const row = sheet.addRow([rollNo, name, statusText, timeJoinedStr, minutesLate]);

        row.getCell(3).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: color || 'FFFFFF' }
        };
        row.getCell(1).alignment = { horizontal: 'center' };
        row.getCell(3).alignment = { horizontal: 'center' };
    });

    sheet.addRow([]);
    const totalEnrolled = session.totalStudents || (totalPresent + totalLate + totalAbsent);
    const pct = totalEnrolled > 0 ? ((totalPresent / totalEnrolled) * 100).toFixed(2) : 0;
    
    const summaryRow = sheet.addRow(['Summary', `Present: ${totalPresent}`, `Late: ${totalLate}`, `Absent: ${totalAbsent}`, `Attendance %: ${pct}%`]);
    summaryRow.font = { bold: true };

    const buffer = await workbook.xlsx.writeBuffer();
    return buffer;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PROFESSIONAL SESSION EXCEL REPORT — College-quality attendance sheet
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const fmtDate = (timestamp) => {
    if (!timestamp) return 'N/A';
    const date = timestamp.toDate ? timestamp.toDate() : (timestamp._seconds ? new Date(timestamp._seconds * 1000) : new Date(timestamp));
    if (isNaN(date.getTime())) return 'N/A';
    return date.toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
};

const fmtTime = (timestamp) => {
    if (!timestamp) return 'N/A';
    const date = timestamp.toDate ? timestamp.toDate() : (timestamp._seconds ? new Date(timestamp._seconds * 1000) : new Date(timestamp));
    if (isNaN(date.getTime())) return 'N/A';
    return date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
};

const fmtDuration = (start, end) => {
    if (!start || !end) return 'Ongoing';
    const startDate = start.toDate ? start.toDate() : (start._seconds ? new Date(start._seconds * 1000) : new Date(start));
    const endDate = end.toDate ? end.toDate() : (end._seconds ? new Date(end._seconds * 1000) : new Date(end));
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) return 'N/A';
    const diff = endDate - startDate;
    const hours = Math.floor(diff / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    const secs = Math.floor((diff % 60000) / 1000);
    if (hours > 0) return `${hours}h ${mins}m ${secs}s`;
    return `${mins}m ${secs}s`;
};

const getMethodLabel = (method) => {
    if (!method) return 'N/A';
    const labels = {
        qrcode: 'QR Code Scanning',
        gps: 'GPS Location Verification',
        network: 'Network/WiFi Detection',
        bluetooth: 'Bluetooth BLE Beacon'
    };
    return labels[method.toLowerCase()] || method.toUpperCase();
};

const thinBorder = {
    top: { style: 'thin', color: { argb: 'FFE0E0E0' } },
    left: { style: 'thin', color: { argb: 'FFE0E0E0' } },
    bottom: { style: 'thin', color: { argb: 'FFE0E0E0' } },
    right: { style: 'thin', color: { argb: 'FFE0E0E0' } }
};

const getTimestampMs = (timestamp) => {
    if (!timestamp) return null;
    if (timestamp.toMillis) return timestamp.toMillis();
    if (timestamp.toDate) return timestamp.toDate().getTime();
    if (timestamp._seconds) return timestamp._seconds * 1000;
    const d = new Date(timestamp);
    return isNaN(d.getTime()) ? null : d.getTime();
};

export async function generateSessionExcel(sessionData, classData, teacherData, attendanceList) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'SAAMS';
    workbook.created = new Date();
    workbook.modified = new Date();

    const sheet = workbook.addWorksheet('Attendance Report', {
        pageSetup: {
            paperSize: 9,
            orientation: 'portrait',
            fitToPage: true,
            fitToHeight: 0,
            fitToWidth: 1,
            margins: { left: 0.7, right: 0.7, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 }
        },
        headerFooter: {
            oddFooter: 'Page &P of &N | Generated by SAAMS on &D'
        }
    });

    sheet.columns = [
        { key: 'sno', width: 6 },
        { key: 'roll', width: 14 },
        { key: 'name', width: 28 },
        { key: 'status', width: 14 },
        { key: 'time', width: 16 },
        { key: 'late', width: 14 },
        { key: 'method', width: 18 },
        { key: 'remarks', width: 20 }
    ];

    // ────── ROW 1: College Header ──────
    const row1 = sheet.addRow(['SMART ATTENDANCE MANAGEMENT SYSTEM (SAAMS)']);
    sheet.mergeCells('A1:H1');
    const cell1 = sheet.getCell('A1');
    cell1.font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
    cell1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1565C0' } };
    cell1.alignment = { horizontal: 'center', vertical: 'middle' };
    row1.height = 35;

    // ────── ROW 2: Report Title ──────
    const row2 = sheet.addRow(['ATTENDANCE REPORT']);
    sheet.mergeCells('A2:H2');
    const cell2 = sheet.getCell('A2');
    cell2.font = { bold: true, size: 13, color: { argb: 'FF1565C0' } };
    cell2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE3F2FD' } };
    cell2.alignment = { horizontal: 'center', vertical: 'middle' };
    row2.height = 25;

    // ────── ROW 3: Spacer ──────
    const row3 = sheet.addRow([]);
    row3.height = 8;

    // ────── ROW 4: Subject Info Header ──────
    const row4 = sheet.addRow(['  SUBJECT & SESSION INFORMATION']);
    sheet.mergeCells('A4:H4');
    const cell4 = sheet.getCell('A4');
    cell4.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
    cell4.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1976D2' } };
    cell4.alignment = { horizontal: 'left', vertical: 'middle' };
    row4.height = 22;

    // ────── Helper: Add info row ──────
    const addInfoRow = (label1, value1, label2, value2) => {
        const r = sheet.addRow([label1, value1, '', '', label2, value2, '', '']);
        // Merge value cells: B-D and F-H
        const rowNum = r.number;
        sheet.mergeCells(`B${rowNum}:D${rowNum}`);
        sheet.mergeCells(`F${rowNum}:H${rowNum}`);

        // Style label cells
        [1, 5].forEach(col => {
            const c = r.getCell(col);
            c.font = { bold: true, size: 10, color: { argb: 'FF424242' } };
            c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F5' } };
            c.border = thinBorder;
            c.alignment = { vertical: 'middle' };
        });
        // Style value cells
        [2, 6].forEach(col => {
            const c = r.getCell(col);
            c.font = { size: 10 };
            c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
            c.border = thinBorder;
            c.alignment = { vertical: 'middle' };
        });
        return r;
    };

    // ────── ROWS 5-15: Info Table ──────
    addInfoRow('Subject Name', classData.subjectName || sessionData.subjectName || 'N/A',
               'Subject Code', classData.subjectCode || sessionData.subjectCode || 'N/A');
    addInfoRow('Department', classData.departmentName || teacherData.departmentName || 'N/A',
               'Semester', classData.semester ? `Semester ${classData.semester}` : 'N/A');
    addInfoRow('Section', classData.section || 'N/A',
               'Batch', classData.batch || 'N/A');
    addInfoRow('Teacher Name', teacherData.name || classData.teacherName || sessionData.teacherName || 'N/A',
               'Employee ID', teacherData.employeeId || 'N/A');
    addInfoRow('Designation', teacherData.designation || 'Faculty',
               'Min Attendance', `${classData.minAttendance || 75}%`);

    // Row 10: spacer
    const spacer10 = sheet.addRow([]);
    spacer10.height = 6;

    addInfoRow('Session Date', fmtDate(sessionData.startTime),
               'Session ID', sessionData.id || sessionData.sessionId || 'N/A');
    addInfoRow('Start Time', fmtTime(sessionData.startTime),
               'End Time', fmtTime(sessionData.endTime));
    addInfoRow('Duration', fmtDuration(sessionData.startTime, sessionData.endTime),
               'Attendance Method', getMethodLabel(sessionData.method));
    addInfoRow('Room Number', sessionData.roomNumber || 'Not specified',
               'Building', sessionData.buildingName || 'Not specified');
    addInfoRow('Late Threshold', `${sessionData.lateAfterMinutes || 10} minutes`,
               'Auto-Absent After', `${sessionData.autoAbsentMinutes || 30} minutes`);

    // Row 16: spacer
    const spacer16 = sheet.addRow([]);
    spacer16.height = 8;

    // ────── SUMMARY HEADER ──────
    const summaryHeader = sheet.addRow(['  ATTENDANCE SUMMARY']);
    const shNum = summaryHeader.number;
    sheet.mergeCells(`A${shNum}:H${shNum}`);
    const shCell = sheet.getCell(`A${shNum}`);
    shCell.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
    shCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1976D2' } };
    shCell.alignment = { horizontal: 'left', vertical: 'middle' };
    summaryHeader.height = 22;

    // ────── Calculate stats ──────
    let totalPresent = 0;
    let totalLate = 0;
    let totalAbsent = 0;

    attendanceList.forEach(r => {
        const status = r.status;
        const teacherApproved = r.teacherApproved;
        if (status === 'present' || (status === 'late' && teacherApproved === true)) {
            totalPresent++;
        } else if (status === 'late' && teacherApproved !== false) {
            // Late but not yet rejected = still categorised as late
            totalLate++;
        } else {
            // absent, or late+rejected
            totalAbsent++;
        }
    });

    const totalStudents = sessionData.totalStudents || attendanceList.length || 0;
    const percentage = totalStudents > 0 ? ((totalPresent / totalStudents) * 100).toFixed(1) : '0.0';

    // ────── SUMMARY BOXES (2 rows for the boxes) ──────
    const boxRow1Num = summaryHeader.number + 1;
    const boxRow2Num = summaryHeader.number + 2;
    sheet.addRow([]); // box row 1
    sheet.addRow([]); // box row 2
    sheet.getRow(boxRow1Num).height = 20;
    sheet.getRow(boxRow2Num).height = 22;

    // Merge cells for each box
    sheet.mergeCells(`A${boxRow1Num}:B${boxRow1Num}`);
    sheet.mergeCells(`A${boxRow2Num}:B${boxRow2Num}`);
    sheet.mergeCells(`C${boxRow1Num}:D${boxRow1Num}`);
    sheet.mergeCells(`C${boxRow2Num}:D${boxRow2Num}`);
    sheet.mergeCells(`E${boxRow1Num}:F${boxRow1Num}`);
    sheet.mergeCells(`E${boxRow2Num}:F${boxRow2Num}`);
    sheet.mergeCells(`G${boxRow1Num}:H${boxRow1Num}`);
    sheet.mergeCells(`G${boxRow2Num}:H${boxRow2Num}`);

    const boxConfigs = [
        { col: 'A', label: 'TOTAL STUDENTS', value: totalStudents.toString(), bg: 'FF1565C0' },
        { col: 'C', label: 'PRESENT', value: `${totalPresent} (${percentage}%)`, bg: 'FF2E7D32' },
        { col: 'E', label: 'ABSENT', value: totalAbsent.toString(), bg: 'FFC62828' },
        { col: 'G', label: 'LATE / PENDING', value: totalLate.toString(), bg: 'FFE65100' }
    ];

    boxConfigs.forEach(box => {
        const labelCell = sheet.getCell(`${box.col}${boxRow1Num}`);
        labelCell.value = box.label;
        labelCell.font = { bold: true, size: 9, color: { argb: 'FFFFFFFF' } };
        labelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: box.bg } };
        labelCell.alignment = { horizontal: 'center', vertical: 'middle' };

        const valueCell = sheet.getCell(`${box.col}${boxRow2Num}`);
        valueCell.value = box.value;
        valueCell.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
        valueCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: box.bg } };
        valueCell.alignment = { horizontal: 'center', vertical: 'middle' };
    });

    // Row spacer
    const spacerAfterBox = sheet.addRow([]);
    spacerAfterBox.height = 8;

    // ────── TABLE HEADER ──────
    const tableHeader = sheet.addRow(['S.No', 'Roll No', 'Student Name', 'Status', 'Time Joined', 'Minutes Late', 'Method', 'Remarks']);
    tableHeader.height = 20;
    tableHeader.eachCell((cell) => {
        cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1565C0' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = {
            top: { style: 'thin', color: { argb: 'FFFFFFFF' } },
            left: { style: 'thin', color: { argb: 'FFFFFFFF' } },
            bottom: { style: 'thin', color: { argb: 'FFFFFFFF' } },
            right: { style: 'thin', color: { argb: 'FFFFFFFF' } }
        };
    });

    // ────── DATA ROWS ──────
    const startTimeMs = getTimestampMs(sessionData.startTime);

    attendanceList.forEach((record, index) => {
        // Determine status display
        let statusText = 'ABSENT';
        let rowBg = 'FFFFEBEE'; // red tint
        let statusColor = 'FFC62828';

        if (record.status === 'present' || (record.status === 'late' && record.teacherApproved === true)) {
            statusText = 'PRESENT';
            rowBg = index % 2 === 0 ? 'FFE8F5E9' : 'FFC8E6C9';
            statusColor = 'FF2E7D32';
        } else if (record.status === 'late' && record.teacherApproved === null) {
            statusText = 'LATE';
            rowBg = index % 2 === 0 ? 'FFFFF8E1' : 'FFFFF3E0';
            statusColor = 'FFE65100';
        } else if (record.status === 'late' && record.teacherApproved === false) {
            statusText = 'REJECTED';
            rowBg = index % 2 === 0 ? 'FFFFEBEE' : 'FFFFCDD2';
            statusColor = 'FFC62828';
        } else {
            rowBg = index % 2 === 0 ? 'FFFFEBEE' : 'FFFFCDD2';
        }

        // Calculate minutes late
        let minutesLateStr = '-';
        const joinedMs = getTimestampMs(record.joinedAt);
        if (joinedMs && startTimeMs) {
            const diff = Math.max(0, Math.floor((joinedMs - startTimeMs) / 60000));
            minutesLateStr = diff > 0 ? `${diff} mins` : '0 mins';
        }

        // Method string
        let methodStr = getMethodLabel(record.method);
        if (record.method === 'gps' && record.distance !== undefined && record.distance !== null) {
            methodStr = `${methodStr} (${record.distance}m)`;
        }

        // Remarks
        let remarks = '';
        if (record.autoAbsent) remarks = 'Auto-absent';
        else if (record.isSuspicious) remarks = '⚠ Suspicious';
        else if (record.teacherApproved === true && record.status === 'late') remarks = 'Late — Approved';
        else if (record.teacherApproved === false) remarks = 'Late — Rejected';

        const row = sheet.addRow([
            index + 1,
            record.studentRollNumber || record.rollNumber || 'N/A',
            record.studentName || 'Unknown',
            statusText,
            record.joinedAt ? fmtTime(record.joinedAt) : 'Not Marked',
            minutesLateStr,
            methodStr,
            remarks
        ]);
        row.height = 18;

        // Apply styles
        row.eachCell((cell, colNumber) => {
            cell.font = { size: 10 };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } };
            cell.border = thinBorder;
            cell.alignment = { vertical: 'middle', horizontal: colNumber === 3 ? 'left' : 'center' };
        });

        // Status cell bold + colored
        const statusCell = row.getCell(4);
        statusCell.font = { bold: true, size: 10, color: { argb: statusColor } };
    });

    // ────── FOOTER ROW ──────
    const footerSpacer = sheet.addRow([]);
    footerSpacer.height = 6;

    const footerRow = sheet.addRow([`This report was automatically generated by SAAMS (Smart Attendance Management System) on ${new Date().toLocaleString('en-IN')}. For queries contact: admin@saams.edu`]);
    const footerNum = footerRow.number;
    sheet.mergeCells(`A${footerNum}:H${footerNum}`);
    const footerCell = sheet.getCell(`A${footerNum}`);
    footerCell.font = { italic: true, size: 8, color: { argb: 'FF9E9E9E' } };
    footerCell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    footerRow.height = 30;

    // ────── SIGNATURE ROW ──────
    const sigSpacer = sheet.addRow([]);
    sigSpacer.height = 20;

    const sigRow = sheet.addRow([]);
    const sigNum = sigRow.number;
    sheet.mergeCells(`A${sigNum}:C${sigNum}`);
    sheet.mergeCells(`D${sigNum}:E${sigNum}`);
    sheet.mergeCells(`F${sigNum}:H${sigNum}`);

    const sigLeft = sheet.getCell(`A${sigNum}`);
    sigLeft.value = 'Teacher Signature: ____________';
    sigLeft.font = { size: 10 };
    sigLeft.alignment = { horizontal: 'center', vertical: 'bottom' };

    const sigCenter = sheet.getCell(`D${sigNum}`);
    sigCenter.value = 'Date: ____________';
    sigCenter.font = { size: 10 };
    sigCenter.alignment = { horizontal: 'center', vertical: 'bottom' };

    const sigRight = sheet.getCell(`F${sigNum}`);
    sigRight.value = 'HOD Signature: ____________';
    sigRight.font = { size: 10 };
    sigRight.alignment = { horizontal: 'center', vertical: 'bottom' };

    sigRow.height = 40;

    const buffer = await workbook.xlsx.writeBuffer();
    return buffer;
}

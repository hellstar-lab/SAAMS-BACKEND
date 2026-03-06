// PDF GENERATOR
// Generates professional PDF attendance
// certificates and reports for SAAMS.
// Uses pdfkit for PDF generation.

import PDFDocument from 'pdfkit';

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

export async function generateAttendanceCertificate(studentData, summaries, academicYear) {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ margin: 50, size: 'A4' });
            const chunks = [];
            doc.on('data', chunk => chunks.push(chunk));
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            
            // 1. HEADER SECTION
            doc.lineWidth(3).moveTo(50, 40).lineTo(545, 40).stroke();
            doc.moveDown(1);
            doc.font('Helvetica-Bold').fontSize(24).text('SAAMS UNIVERSITY', { align: 'center' });
            doc.font('Helvetica').fontSize(12).text('Smart Attendance Application for Management System', { align: 'center' });
            doc.moveDown(0.5);
            doc.lineWidth(1).moveTo(50, doc.y).lineTo(545, doc.y).stroke();
            doc.moveDown(2);

            // 2. CERTIFICATE TITLE
            doc.font('Helvetica-Bold').fontSize(18).text('ATTENDANCE CERTIFICATE', { align: 'center', underline: true });
            doc.moveDown(2);

            // 3. STUDENT INFO BOX
            const boxTop = doc.y;
            doc.rect(50, boxTop, 495, 80).stroke();
            
            doc.font('Helvetica').fontSize(11);
            doc.text(`Student Name: ${studentData.name || 'N/A'}`, 65, boxTop + 15);
            doc.text(`Roll Number: ${studentData.rollNumber || 'N/A'}`, 65, boxTop + 35);
            doc.text(`Department: ${studentData.departmentName || 'N/A'}`, 65, boxTop + 55);

            doc.text(`Semester: ${studentData.semester || 'N/A'}`, 300, boxTop + 15);
            doc.text(`Section: ${studentData.section || 'N/A'}`, 300, boxTop + 35);
            doc.text(`Academic Year: ${academicYear || 'N/A'}`, 300, boxTop + 55);
            
            doc.y = boxTop + 100;

            // 4. DECLARATION TEXT
            doc.text(`This is to certify that the above mentioned student has maintained the following attendance record for the academic year ${academicYear}:`, 50, doc.y, { align: 'justify', width: 495 });
            doc.moveDown(1.5);

            // 5. SUBJECT TABLE
            const tableTop = doc.y;
            
            doc.font('Helvetica-Bold').fontSize(10);
            doc.text('Subject', 55, tableTop);
            doc.text('Code', 250, tableTop);
            doc.text('Present', 310, tableTop);
            doc.text('Late', 370, tableTop);
            doc.text('Absent', 420, tableTop);
            doc.text('Total', 470, tableTop);
            doc.text('%', 520, tableTop);
            
            doc.moveTo(50, tableTop + 15).lineTo(545, tableTop + 15).stroke();
            
            let currentY = tableTop + 25;
            let sumPercentage = 0;
            let eligible = true;
            
            if (summaries && summaries.length > 0) {
                doc.font('Helvetica').fontSize(10);
                summaries.forEach(s => {
                    doc.fillColor('black');
                    doc.text(s.subjectName?.substring(0,35) || 'Unknown', 55, currentY);
                    doc.text(s.subjectCode || 'N/A', 250, currentY);
                    doc.text(s.present?.toString() || '0', 310, currentY);
                    doc.text(s.late?.toString() || '0', 370, currentY);
                    doc.text(s.absent?.toString() || '0', 420, currentY);
                    doc.text(s.totalSessions?.toString() || '0', 470, currentY);
                    
                    const p = s.percentage || 0;
                    sumPercentage += p;
                    if (s.isBelowThreshold) eligible = false;
                    
                    if (p >= 75) doc.fillColor('#2E7D32'); // Green
                    else doc.fillColor('#C62828'); // Red
                    
                    doc.font('Helvetica-Bold');
                    doc.text(`${p}%`, 520, currentY);
                    doc.font('Helvetica');
                    doc.fillColor('black');
                    
                    currentY += 20;
                });
                
                doc.moveTo(50, currentY).lineTo(545, currentY).stroke();
            } else {
                doc.text('No attendance data available.', 55, currentY);
                currentY += 30;
                eligible = false;
            }
            
            doc.y = currentY + 30;

            // 6. SUMMARY SECTION
            const overallAvg = summaries && summaries.length > 0 ? (sumPercentage / summaries.length).toFixed(1) : 0;
            const statusStr = eligible ? 'ELIGIBLE for examination' : 'NOT ELIGIBLE for examination';
            
            doc.font('Helvetica-Bold').fontSize(14);
            doc.text(`Overall Attendance: ${overallAvg}%`, 50, doc.y);
            
            doc.moveDown(0.5);
            if (eligible) doc.fillColor('#2E7D32');
            else doc.fillColor('#C62828');
            doc.text(`Status: ${statusStr}`);
            
            // 7. FOOTER
            doc.fillColor('black');
            doc.font('Helvetica').fontSize(9);
            const footerY = 750;
            doc.text(`Generated on: ${new Date().toLocaleString()}`, 50, footerY);
            doc.text('This is a computer-generated document.', 50, footerY + 15);
            doc.text('Verify at: saams.edu/verify', 50, footerY + 30);
            
            doc.lineWidth(1).moveTo(50, 785).lineTo(545, 785).stroke();

            doc.end();
        } catch (error) {
            reject(error);
        }
    });
}

export async function generateSessionReport(sessionData, attendanceRecords, classInfo) {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ margin: 50, size: 'A4' });
            const chunks = [];
            doc.on('data', chunk => chunks.push(chunk));
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            
            // 1. HEADER
            doc.font('Helvetica-Bold').fontSize(18).text('SAAMS — Session Attendance Report', { align: 'center' });
            doc.moveDown(0.5);
            doc.lineWidth(1).moveTo(50, doc.y).lineTo(545, doc.y).stroke();
            doc.moveDown(1);
            
            // 2. SESSION INFO
            doc.font('Helvetica').fontSize(10);
            const infoY = doc.y;
            
            doc.text(`Subject: ${sessionData.subjectName || 'N/A'} (${sessionData.subjectCode || 'N/A'})`, 50, infoY);
            doc.text(`Teacher: ${sessionData.teacherName || 'N/A'}`, 50, infoY + 15);
            doc.text(`Method: ${formatMethod(sessionData.method)}`, 50, infoY + 30);
            doc.text(`Room: ${sessionData.roomNumber || 'N/A'}`, 50, infoY + 45);
            
            doc.text(`Date: ${formatDate(sessionData.startTime)}`, 320, infoY);
            doc.text(`Start Time: ${formatTime(sessionData.startTime)}`, 320, infoY + 15);
            doc.text(`End Time: ${sessionData.endTime ? formatTime(sessionData.endTime) : 'Ongoing'}`, 320, infoY + 30);
            
            let duration = 'N/A';
            if (sessionData.startTime && sessionData.endTime) {
                const sDate = sessionData.startTime.toDate ? sessionData.startTime.toDate() : new Date(sessionData.startTime);
                const eDate = sessionData.endTime.toDate ? sessionData.endTime.toDate() : new Date(sessionData.endTime);
                if (!isNaN(sDate.getTime()) && !isNaN(eDate.getTime())) {
                    duration = `${Math.round((eDate - sDate) / 60000)} mins`;
                }
            }
            doc.text(`Duration: ${duration}`, 320, infoY + 45);
            
            doc.y = infoY + 75;

            // Calculate aggregates
            let presentCount = 0;
            let lateCount = 0;
            let absentCount = 0;
            
            const presentStudents = [];
            const lateStudents = [];
            const absentStudents = [];
            const suspiciousRecords = [];
            
            if (attendanceRecords) {
                attendanceRecords.forEach(r => {
                    if (r.status === 'present') { presentCount++; presentStudents.push(r); }
                    else if (r.status === 'late') { lateCount++; lateStudents.push(r); }
                    else { absentCount++; absentStudents.push(r); }
                    
                    if (r.isSuspicious) suspiciousRecords.push(r);
                });
            }
            
            const enrol = sessionData.totalStudents || 1;
            const pPerc = ((presentCount / enrol) * 100).toFixed(1);
            
            // 3. STATISTICS BOX
            const boxY = doc.y;
            doc.rect(50, boxY, 495, 60).stroke();
            
            doc.font('Helvetica-Bold').fontSize(14);
            doc.fillColor('#2E7D32').text(`PRESENT: ${presentCount} (${pPerc}%)`, 65, boxY + 20);
            doc.fillColor('#F57F17').text(`LATE: ${lateCount}`, 240, boxY + 20);
            doc.fillColor('#C62828').text(`ABSENT: ${absentCount}`, 340, boxY + 20);
            doc.fillColor('black').fontSize(10).text(`TOTAL ENROLLED: ${sessionData.totalStudents || 0}`, 340, boxY + 40);
            
            doc.y = boxY + 80;
            
            // Helper to render lists
            const renderList = (title, count, arr, color, lateMinsCol) => {
                doc.moveDown(1);
                doc.font('Helvetica-Bold').fontSize(12).fillColor(color).text(`${title} (${count})`);
                doc.fillColor('black').font('Helvetica').fontSize(10);
                
                if (arr.length === 0) {
                    doc.text('None', { indent: 20 });
                    return;
                }
                
                arr.forEach(s => {
                    const extra = lateMinsCol && s.joinedAt && sessionData.startTime ? 
                       ` — ${Math.round(((s.joinedAt.toDate ? s.joinedAt.toDate() : new Date(s.joinedAt)) - (sessionData.startTime.toDate ? sessionData.startTime.toDate() : new Date(sessionData.startTime)))/60000)} mins late` : 
                       (!lateMinsCol && s.joinedAt ? ` — Joined: ${formatTime(s.joinedAt)}` : '');
                    doc.text(`• ${s.studentRollNumber} — ${s.studentName}${extra}`, { indent: 20 });
                });
            };

            // 4. STUDENT LIST
            const pIcon = '✓ PRESENT STUDENTS';
            const lIcon = '⏱ LATE STUDENTS';
            const aIcon = '✗ ABSENT STUDENTS';
            
            renderList(pIcon, presentCount, presentStudents, '#2E7D32', false);
            renderList(lIcon, lateCount, lateStudents, '#F57F17', true);
            renderList(aIcon, absentCount, absentStudents, '#C62828', false);

            // 5. FRAUD ALERTS
            if (suspiciousRecords.length > 0) {
                doc.moveDown(2);
                doc.font('Helvetica-Bold').fontSize(12).fillColor('#B71C1C').text('⚠ SUSPICIOUS ACTIVITY DETECTED');
                doc.fillColor('black').font('Helvetica').fontSize(10);
                
                suspiciousRecords.forEach(s => {
                    const dStr = s.distanceFromClass ? `${s.distanceFromClass.toFixed(1)}m` : 'N/A';
                    doc.text(`• ${s.studentName} (${s.studentRollNumber}) - Dist: ${dStr}, Method: ${formatMethod(s.method)}`, { indent: 20 });
                });
            }

            // 6. FOOTER
            doc.fillColor('black');
            doc.font('Helvetica').fontSize(9);
            const fY = 780;
            doc.text(`Generated on: ${new Date().toLocaleString()}`, 50, fY, { align: 'center' });
            
            doc.end();
        } catch (error) {
            reject(error);
        }
    });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PROFESSIONAL SESSION PDF REPORT — College-quality attendance sheet
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const BLUE = '#1565C0';
const DARK_BLUE = '#0D47A1';
const GREEN = '#2E7D32';
const RED = '#C62828';
const ORANGE = '#E65100';
const GREY = '#757575';
const LIGHT_GREY = '#F5F5F5';
const WHITE = '#FFFFFF';
const BLACK = '#212121';

const pdfFormatDate = (timestamp) => {
    if (!timestamp) return 'N/A';
    const date = timestamp.toDate ? timestamp.toDate() : (timestamp._seconds ? new Date(timestamp._seconds * 1000) : new Date(timestamp));
    if (isNaN(date.getTime())) return 'N/A';
    return date.toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
};

const pdfFormatTime = (timestamp) => {
    if (!timestamp) return 'N/A';
    const date = timestamp.toDate ? timestamp.toDate() : (timestamp._seconds ? new Date(timestamp._seconds * 1000) : new Date(timestamp));
    if (isNaN(date.getTime())) return 'N/A';
    return date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
};

const pdfFormatDuration = (start, end) => {
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

const pdfGetMethodLabel = (method) => {
    if (!method) return 'N/A';
    const labels = { qrcode: 'QR Code Scanning', gps: 'GPS Location Verification', network: 'Network/WiFi Detection', bluetooth: 'Bluetooth BLE Beacon' };
    return labels[method.toLowerCase()] || method.toUpperCase();
};

const pdfGetTimestampMs = (timestamp) => {
    if (!timestamp) return null;
    if (timestamp.toMillis) return timestamp.toMillis();
    if (timestamp.toDate) return timestamp.toDate().getTime();
    if (timestamp._seconds) return timestamp._seconds * 1000;
    const d = new Date(timestamp);
    return isNaN(d.getTime()) ? null : d.getTime();
};

export async function generateSessionPDF(sessionData, classData, teacherData, attendanceList) {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({
                size: 'A4',
                margin: 40,
                bufferPages: true,
                info: {
                    Title: `Attendance Report — ${classData.subjectName || sessionData.subjectName || 'Session'}`,
                    Author: teacherData.name || 'SAAMS',
                    Subject: 'Session Attendance Report',
                    Creator: 'SAAMS — Smart Attendance Management System'
                }
            });
            const chunks = [];
            doc.on('data', chunk => chunks.push(chunk));
            doc.on('end', () => resolve(Buffer.concat(chunks)));

            const pageWidth = 515; // A4 with 40px margins
            const leftMargin = 40;
            const sessionDate = pdfFormatDate(sessionData.startTime);

            // Calculate stats
            const totalStudents = sessionData.totalStudents || attendanceList.length || 0;
            const presentCount = attendanceList.filter(d => d.status === 'present' || (d.status === 'late' && d.teacherApproved === true)).length;
            const lateCount = attendanceList.filter(d => d.status === 'late' && d.teacherApproved === null).length;
            const absentCount = attendanceList.filter(d => d.status === 'absent').length;
            const percentage = totalStudents > 0 ? ((presentCount / totalStudents) * 100).toFixed(1) : '0.0';
            const startTimeMs = pdfGetTimestampMs(sessionData.startTime);

            // ────── Helper: draw page footer ──────
            const drawPageFooter = (pageNum, totalPages) => {
                const footerY = 780;
                doc.save();
                doc.lineWidth(0.5).moveTo(leftMargin, footerY - 5).lineTo(leftMargin + pageWidth, footerY - 5).strokeColor(GREY).stroke();
                doc.font('Helvetica').fontSize(7).fillColor(GREY);
                doc.text('SAAMS Attendance Report', leftMargin, footerY, { width: 170, align: 'left' });
                doc.text(`${classData.subjectName || sessionData.subjectName || ''} — ${sessionDate}`, leftMargin + 170, footerY, { width: 175, align: 'center' });
                doc.text(`Page ${pageNum} of ${totalPages}`, leftMargin + 345, footerY, { width: 170, align: 'right' });
                doc.restore();
            };

            // ════════════════════════════════════════
            // PAGE 1 — HEADER
            // ════════════════════════════════════════

            // Blue banner
            doc.rect(0, 0, 595, 80).fill(BLUE);
            doc.font('Helvetica-Bold').fontSize(24).fillColor(WHITE);
            doc.text('SAAMS', leftMargin, 18, { width: pageWidth });
            doc.font('Helvetica').fontSize(10).fillColor(WHITE);
            doc.text('Smart Attendance Management System', leftMargin, 48, { width: pageWidth });

            // Dark blue line
            doc.rect(0, 80, 595, 3).fill(DARK_BLUE);

            // Report title
            doc.y = 100;
            doc.font('Helvetica-Bold').fontSize(18).fillColor(BLUE);
            doc.text('ATTENDANCE REPORT', leftMargin, 100, { align: 'center', width: pageWidth });
            doc.font('Helvetica-Bold').fontSize(14).fillColor(BLACK);
            doc.text(`${classData.subjectName || sessionData.subjectName || 'N/A'} (${classData.subjectCode || sessionData.subjectCode || 'N/A'})`, leftMargin, 125, { align: 'center', width: pageWidth });
            doc.font('Helvetica').fontSize(11).fillColor(GREY);
            doc.text(classData.departmentName || teacherData.departmentName || '', leftMargin, 145, { align: 'center', width: pageWidth });

            // Divider
            doc.lineWidth(1).moveTo(leftMargin, 165).lineTo(leftMargin + pageWidth, 165).strokeColor('#E0E0E0').stroke();

            // ────── INFO SECTION (two columns) ──────
            doc.y = 175;
            const col1X = leftMargin;
            const col2X = leftMargin + 270;
            let infoY = 175;

            const drawInfoLine = (label, value, x, y) => {
                doc.font('Helvetica-Bold').fontSize(9).fillColor(GREY);
                doc.text(label, x, y, { width: 110 });
                doc.font('Helvetica').fontSize(9).fillColor(BLACK);
                doc.text(value || 'N/A', x + 112, y, { width: 150 });
            };

            // Left column
            drawInfoLine('Session Date:', pdfFormatDate(sessionData.startTime), col1X, infoY);
            drawInfoLine('Start Time:', pdfFormatTime(sessionData.startTime), col1X, infoY + 16);
            drawInfoLine('End Time:', sessionData.endTime ? pdfFormatTime(sessionData.endTime) : 'Ongoing', col1X, infoY + 32);
            drawInfoLine('Duration:', pdfFormatDuration(sessionData.startTime, sessionData.endTime), col1X, infoY + 48);
            drawInfoLine('Method:', pdfGetMethodLabel(sessionData.method), col1X, infoY + 64);

            // Right column
            drawInfoLine('Teacher Name:', teacherData.name || classData.teacherName || sessionData.teacherName || 'N/A', col2X, infoY);
            drawInfoLine('Employee ID:', teacherData.employeeId || 'N/A', col2X, infoY + 16);
            drawInfoLine('Designation:', teacherData.designation || 'Faculty', col2X, infoY + 32);
            drawInfoLine('Room:', sessionData.roomNumber || 'Not specified', col2X, infoY + 48);
            drawInfoLine('Building:', sessionData.buildingName || 'Not specified', col2X, infoY + 64);

            // Divider
            infoY += 85;
            doc.lineWidth(0.5).moveTo(leftMargin, infoY).lineTo(leftMargin + pageWidth, infoY).strokeColor('#E0E0E0').stroke();
            infoY += 10;

            // Second info block
            drawInfoLine('Subject Code:', classData.subjectCode || sessionData.subjectCode || 'N/A', col1X, infoY);
            drawInfoLine('Semester:', classData.semester ? `Semester ${classData.semester}` : 'N/A', col1X, infoY + 16);
            drawInfoLine('Section:', classData.section || 'N/A', col1X, infoY + 32);
            drawInfoLine('Batch:', classData.batch || 'N/A', col1X, infoY + 48);

            drawInfoLine('Min Attendance:', `${classData.minAttendance || 75}%`, col2X, infoY);
            drawInfoLine('Late Threshold:', `${sessionData.lateAfterMinutes || 10} mins`, col2X, infoY + 16);
            drawInfoLine('Auto-Absent:', `${sessionData.autoAbsentMinutes || 30} mins`, col2X, infoY + 32);
            drawInfoLine('Session ID:', (sessionData.id || sessionData.sessionId || 'N/A').substring(0, 20), col2X, infoY + 48);

            infoY += 70;

            // ────── SUMMARY BOXES (4 colored boxes in a row) ──────
            const boxWidth = (pageWidth - 15) / 4; // 3 gaps of 5px
            const boxHeight = 50;

            const boxes = [
                { label: 'Total Students', value: totalStudents.toString(), bg: BLUE },
                { label: 'Present', value: `${presentCount} (${percentage}%)`, bg: GREEN },
                { label: 'Absent', value: absentCount.toString(), bg: RED },
                { label: 'Late/Pending', value: lateCount.toString(), bg: ORANGE }
            ];

            boxes.forEach((box, idx) => {
                const bx = leftMargin + idx * (boxWidth + 5);
                doc.roundedRect(bx, infoY, boxWidth, boxHeight, 4).fill(box.bg);

                doc.font('Helvetica-Bold').fontSize(20).fillColor(WHITE);
                doc.text(box.value, bx, infoY + 8, { width: boxWidth, align: 'center' });

                doc.font('Helvetica').fontSize(8).fillColor(WHITE);
                doc.text(box.label, bx, infoY + 34, { width: boxWidth, align: 'center' });
            });

            infoY += boxHeight + 15;

            // ────── ATTENDANCE TABLE ──────
            // Column widths (percentage of pageWidth)
            const colWidths = [
                pageWidth * 0.05,  // S.No
                pageWidth * 0.12,  // Roll No
                pageWidth * 0.28,  // Name
                pageWidth * 0.12,  // Status
                pageWidth * 0.14,  // Time
                pageWidth * 0.10,  // Late
                pageWidth * 0.12,  // Method
                pageWidth * 0.07   // Remarks
            ];
            const colHeaders = ['S.No', 'Roll No', 'Student Name', 'Status', 'Time Joined', 'Late', 'Method', 'Rmks'];
            const rowHeight = 18;

            // Helper: draw table header
            const drawTableHeader = (y) => {
                doc.rect(leftMargin, y, pageWidth, rowHeight + 2).fill(BLUE);
                doc.font('Helvetica-Bold').fontSize(8).fillColor(WHITE);
                let cx = leftMargin + 2;
                colHeaders.forEach((h, i) => {
                    doc.text(h, cx, y + 4, { width: colWidths[i], align: 'center' });
                    cx += colWidths[i];
                });
                return y + rowHeight + 2;
            };

            let currentY = drawTableHeader(infoY);

            // Draw student rows
            attendanceList.forEach((record, index) => {
                // Check if we need a new page
                if (currentY + rowHeight > 770) {
                    doc.addPage();
                    currentY = 50;
                    currentY = drawTableHeader(currentY);
                }

                // Determine status
                let statusText = 'ABSENT';
                let statusColor = RED;
                let rowFill = index % 2 === 0 ? WHITE : LIGHT_GREY;

                if (record.status === 'present' || (record.status === 'late' && record.teacherApproved === true)) {
                    statusText = 'PRESENT';
                    statusColor = GREEN;
                    rowFill = index % 2 === 0 ? '#E8F5E9' : '#C8E6C9';
                } else if (record.status === 'late' && record.teacherApproved === null) {
                    statusText = 'LATE';
                    statusColor = ORANGE;
                    rowFill = index % 2 === 0 ? '#FFF8E1' : '#FFF3E0';
                } else if (record.status === 'late' && record.teacherApproved === false) {
                    statusText = 'REJECTED';
                    statusColor = RED;
                    rowFill = index % 2 === 0 ? '#FFEBEE' : '#FFCDD2';
                } else {
                    rowFill = index % 2 === 0 ? '#FFEBEE' : '#FFCDD2';
                }

                // Minutes late
                let lateStr = '-';
                const joinedMs = pdfGetTimestampMs(record.joinedAt);
                if (joinedMs && startTimeMs) {
                    const diff = Math.max(0, Math.floor((joinedMs - startTimeMs) / 60000));
                    lateStr = diff > 0 ? `${diff}m` : '0m';
                }

                // Method
                let methodShort = record.method || 'N/A';
                if (methodShort === 'gps' && record.distance != null) methodShort = `GPS ${record.distance}m`;
                else if (methodShort === 'gps') methodShort = 'GPS';
                else if (methodShort === 'qrcode') methodShort = 'QR';

                // Remarks
                let rmk = '';
                if (record.autoAbsent) rmk = 'Auto';
                else if (record.isSuspicious) rmk = '⚠';
                else if (record.teacherApproved === true && record.status === 'late') rmk = '✓ Appr';
                else if (record.teacherApproved === false) rmk = '✗ Rej';

                // Draw row background
                doc.rect(leftMargin, currentY, pageWidth, rowHeight).fill(rowFill);

                // Draw thin borders
                doc.lineWidth(0.3).strokeColor('#E0E0E0');
                doc.rect(leftMargin, currentY, pageWidth, rowHeight).stroke();

                // Cell values
                const cellValues = [
                    (index + 1).toString(),
                    (record.studentRollNumber || record.rollNumber || 'N/A').substring(0, 12),
                    (record.studentName || 'Unknown').substring(0, 28),
                    statusText,
                    record.joinedAt ? pdfFormatTime(record.joinedAt) : 'N/A',
                    lateStr,
                    methodShort,
                    rmk
                ];

                let cx = leftMargin + 2;
                cellValues.forEach((val, i) => {
                    if (i === 3) {
                        // Status cell — colored
                        doc.font('Helvetica-Bold').fontSize(7).fillColor(statusColor);
                    } else if (i === 2) {
                        // Name — left aligned
                        doc.font('Helvetica').fontSize(7).fillColor(BLACK);
                    } else {
                        doc.font('Helvetica').fontSize(7).fillColor(BLACK);
                    }
                    doc.text(val, cx, currentY + 5, { width: colWidths[i], align: i === 2 ? 'left' : 'center' });
                    cx += colWidths[i];
                });

                currentY += rowHeight;
            });

            // ────── SIGNATURE SECTION ──────
            if (currentY + 120 > 770) {
                doc.addPage();
                currentY = 50;
            }

            currentY += 20;
            doc.font('Helvetica').fontSize(8).fillColor(GREY);
            doc.text('Declaration: This attendance record is system-generated and verified by the concerned teacher.', leftMargin, currentY, { width: pageWidth, align: 'center' });

            currentY += 25;
            const sigBoxWidth = (pageWidth - 20) / 3;

            // Teacher signature box
            doc.rect(leftMargin, currentY, sigBoxWidth, 60).stroke();
            doc.font('Helvetica-Bold').fontSize(8).fillColor(BLACK);
            doc.text('Teacher Signature', leftMargin + 5, currentY + 5, { width: sigBoxWidth - 10 });
            doc.font('Helvetica').fontSize(7).fillColor(GREY);
            doc.text(`Name: ${teacherData.name || classData.teacherName || 'N/A'}`, leftMargin + 5, currentY + 18);
            doc.text('Date: _______________', leftMargin + 5, currentY + 30);
            doc.text('Signature: _______________', leftMargin + 5, currentY + 42);

            // HOD signature box
            const hodX = leftMargin + sigBoxWidth + 10;
            doc.rect(hodX, currentY, sigBoxWidth, 60).stroke();
            doc.font('Helvetica-Bold').fontSize(8).fillColor(BLACK);
            doc.text('HOD Verification', hodX + 5, currentY + 5, { width: sigBoxWidth - 10 });
            doc.font('Helvetica').fontSize(7).fillColor(GREY);
            doc.text(`Department: ${classData.departmentName || teacherData.departmentName || 'N/A'}`, hodX + 5, currentY + 18);
            doc.text('Date: _______________', hodX + 5, currentY + 30);
            doc.text('Signature: _______________', hodX + 5, currentY + 42);

            // Official stamp box
            const stampX = leftMargin + 2 * (sigBoxWidth + 10);
            doc.rect(stampX, currentY, sigBoxWidth, 60).stroke();
            doc.font('Helvetica-Bold').fontSize(8).fillColor(BLACK);
            doc.text('Official Stamp', stampX + 5, currentY + 5, { width: sigBoxWidth - 10 });
            doc.rect(stampX + 20, currentY + 18, sigBoxWidth - 40, 35).lineWidth(0.5).dash(3).stroke();
            doc.font('Helvetica').fontSize(7).fillColor(GREY);
            doc.text('Official Stamp', stampX + 20, currentY + 32, { width: sigBoxWidth - 40, align: 'center' });
            doc.undash();

            currentY += 75;
            doc.font('Helvetica').fontSize(7).fillColor(GREY);
            doc.text(`Generated on ${new Date().toLocaleString('en-IN')} by SAAMS — Smart Attendance Management System`, leftMargin, currentY, { width: pageWidth, align: 'center' });
            doc.text('This is a computer-generated document.', leftMargin, currentY + 12, { width: pageWidth, align: 'center' });

            // ────── Add page footers to all pages ──────
            const totalPages = doc.bufferedPageRange().count;
            for (let i = 0; i < totalPages; i++) {
                doc.switchToPage(i);
                drawPageFooter(i + 1, totalPages);
            }

            doc.end();
        } catch (error) {
            reject(error);
        }
    });
}

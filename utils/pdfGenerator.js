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

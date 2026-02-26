import fs from 'fs';

const collection = {
  info: {
    name: "SAAMS — Complete API Collection",
    description: "SAAMS — Smart Attendance Application\nfor Management System\nComplete API test collection.\n87 endpoints across 10 folders.\nImport the SAAMS Environment file first,\nthen run Login requests to populate\ntokens before testing other endpoints.\n\nDEMO CREDENTIALS:\nSuper Admin: admin@saams.edu / Admin@2024\nHOD: priya.mehta@saams.edu / Teacher@123\nTeacher: amit.kumar@saams.edu / Teacher@123\nStudent: 22cs001@student.saams.edu / Student@123",
    schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  event: [
    {
      listen: "prerequest",
      script: {
        type: "text/javascript",
        exec: ["pm.request.headers.add({key: 'Content-Type', value: 'application/json'});"]
      }
    }
  ],
  item: []
};

function createItem(req) {
  const item = {
    name: req.name,
    request: {
      method: req.method,
      header: [],
      url: {
        raw: req.url,
        host: [ "{{baseUrl}}" ],
        path: req.url.replace("{{baseUrl}}/", "").split("/")
      }
    }
  };

  if (req.url.includes("?")) {
    const rawPath = req.url.replace("{{baseUrl}}/", "");
    const [pathPart, queryPart] = rawPath.split("?");
    item.request.url.path = pathPart.split("/");
    item.request.url.query = queryPart.split("&").map(q => {
      const [key, value] = q.split("=");
      return { key, value };
    });
  }

  if (req.auth) {
    let tokenVar = req.auth.replace("Bearer ", "");
    item.request.header.push({
      key: "Authorization",
      value: `Bearer ${tokenVar}`
    });
  }

  if (req.body) {
    let bodyStr = typeof req.body === 'string' ? req.body : JSON.stringify(req.body, null, 2);
    item.request.body = {
      mode: "raw",
      raw: bodyStr
    };
  }

  if (req.test) {
    item.event = [
      {
        listen: "test",
        script: {
          type: "text/javascript",
          exec: req.test.split("\n")
        }
      }
    ];
  }
  return item;
}

const foldersData = [
  {
    name: "━━━ FOLDER 1: 🔐 Authentication ━━━",
    items: [
      { name: "1. Register Student", method: "POST", url: "{{baseUrl}}/api/auth/register/student", body: { name: "Aarav Sharma", email: "22cs001@student.saams.edu", password: "Student@123", rollNumber: "22CS001", phone: "+91-9876543201" }, test: 'pm.test("Status is 201", () => pm.response.to.have.status(201));\npm.test("Has studentId", () => { const json = pm.response.json(); pm.expect(json.success).to.be.true; pm.expect(json.data.role).to.equal("student"); });' },
      { name: "2. Register Teacher", method: "POST", url: "{{baseUrl}}/api/auth/register/teacher", body: { name: "Mr. Amit Kumar", email: "amit.kumar@saams.edu", password: "Teacher@123", employeeId: "CS-T002", designation: "Assistant Professor" }, test: 'pm.test("Status is 201", () => pm.response.to.have.status(201));\npm.test("Role is teacher", () => { pm.expect(pm.response.json().data.role).to.equal("teacher"); });' },
      { name: "3. Register Super Admin", method: "POST", url: "{{baseUrl}}/api/auth/register/superadmin", body: { name: "Dr. Rajesh Sharma", email: "admin@saams.edu", password: "Admin@2024", setupKey: "{{setupKey}}" }, test: 'pm.test("Status is 201", () => pm.response.to.have.status(201));\npm.test("Role is superAdmin", () => { pm.expect(pm.response.json().data.role).to.equal("superAdmin"); });' },
      { name: "4. Login — Super Admin", method: "POST", url: "{{baseUrl}}/api/auth/login", body: { email: "admin@saams.edu", password: "Admin@2024" }, test: 'pm.test("Login success", () => { const json = pm.response.json(); pm.expect(json.success).to.be.true; if (json.data && json.data.token) { pm.environment.set("adminToken", json.data.token); pm.environment.set("adminUid", json.data.uid); } });' },
      { name: "5. Login — HOD", method: "POST", url: "{{baseUrl}}/api/auth/login", body: { email: "priya.mehta@saams.edu", password: "Teacher@123" }, test: 'pm.test("Login success", () => { const json = pm.response.json(); pm.expect(json.success).to.be.true; if (json.data && json.data.token) { pm.environment.set("hodToken", json.data.token); pm.environment.set("hodUid", json.data.uid); } });' },
      { name: "6. Login — Teacher", method: "POST", url: "{{baseUrl}}/api/auth/login", body: { email: "amit.kumar@saams.edu", password: "Teacher@123" }, test: 'pm.test("Login success", () => { const json = pm.response.json(); pm.expect(json.success).to.be.true; if (json.data && json.data.token) { pm.environment.set("teacherToken", json.data.token); pm.environment.set("teacherUid", json.data.uid); } });' },
      { name: "7. Login — Student", method: "POST", url: "{{baseUrl}}/api/auth/login", body: { email: "22cs001@student.saams.edu", password: "Student@123" }, test: 'pm.test("Login success", () => { const json = pm.response.json(); pm.expect(json.success).to.be.true; if (json.data && json.data.token) { pm.environment.set("studentToken", json.data.token); pm.environment.set("studentUid", json.data.uid); } });' },
      { name: "8. Get My Profile", method: "GET", url: "{{baseUrl}}/api/auth/profile", auth: "{{studentToken}}", test: 'pm.test("Profile access", () => { const j = pm.response.json(); pm.response.to.have.status(200); pm.expect(j.data.name).to.exist; pm.expect(j.data.role).to.exist; pm.expect(j.data.email).to.exist; });' },
      { name: "9. Update Profile", method: "PATCH", url: "{{baseUrl}}/api/auth/profile", auth: "{{teacherToken}}", body: { phone: "+91-9876543299", designation: "Senior Assistant Professor" }, test: 'pm.test("Status is 200", () => pm.response.to.have.status(200));\npm.test("Success true", () => pm.expect(pm.response.json().success).to.be.true);' },
      { name: "10. Update FCM Token", method: "PATCH", url: "{{baseUrl}}/api/auth/fcm-token", auth: "{{studentToken}}", body: { fcmToken: "demo_fcm_token_abc123" }, test: 'pm.test("Status is 200", () => pm.response.to.have.status(200));' },
      { name: "11. Deactivate Account", method: "PATCH", url: "{{baseUrl}}/api/auth/deactivate/{{studentUid}}", auth: "{{adminToken}}", body: { reason: "Test deactivation for demo" }, test: 'pm.test("Status is 200", () => pm.response.to.have.status(200));' },
      { name: "12. Reactivate Account", method: "PATCH", url: "{{baseUrl}}/api/auth/reactivate/{{studentUid}}", auth: "{{adminToken}}", test: 'pm.test("Status is 200", () => pm.response.to.have.status(200));' }
    ]
  },
  {
    name: "━━━ FOLDER 2: 🏛️ Departments ━━━",
    items: [
      { name: "13. Create Department", method: "POST", url: "{{baseUrl}}/api/departments", auth: "{{adminToken}}", body: { name: "Computer Science", code: "CS", minAttendance: 75 }, test: 'pm.test("Department created", () => { const json = pm.response.json(); pm.expect(json.success).to.be.true; if (json.data && json.data.departmentId) { pm.environment.set("departmentId", json.data.departmentId); } });' },
      { name: "14. Get All Departments", method: "GET", url: "{{baseUrl}}/api/departments", auth: "{{studentToken}}", test: 'pm.test("Status 200", () => pm.response.to.have.status(200));\npm.test("Data is array", () => pm.expect(Array.isArray(pm.response.json().data)).to.be.true);' },
      { name: "15. Get Department By ID", method: "GET", url: "{{baseUrl}}/api/departments/{{departmentId}}", auth: "{{adminToken}}", test: 'pm.test("Status 200", () => pm.response.to.have.status(200));\npm.test("Has liveCounts", () => pm.expect(pm.response.json().data.liveCounts).to.exist);' },
      { name: "16. Assign HOD", method: "PATCH", url: "{{baseUrl}}/api/departments/{{departmentId}}/assign-hod", auth: "{{adminToken}}", body: { teacherId: "{{hodUid}}" }, test: 'pm.test("Status is 200", () => pm.response.to.have.status(200));' },
      { name: "17. Update Department", method: "PATCH", url: "{{baseUrl}}/api/departments/{{departmentId}}", auth: "{{adminToken}}", body: { minAttendance: 80 }, test: 'pm.test("Status is 200", () => pm.response.to.have.status(200));' },
      { name: "18. Get Department Stats", method: "GET", url: "{{baseUrl}}/api/departments/{{departmentId}}/stats", auth: "{{adminToken}}", test: 'pm.test("Status 200", () => pm.response.to.have.status(200));\npm.test("Has totalTeachers count", () => pm.expect(pm.response.json().data.totalTeachers).to.exist);' }
    ]
  },
  {
    name: "━━━ FOLDER 3: 📚 Classes ━━━",
    items: [
      { name: "19. Create Class", method: "POST", url: "{{baseUrl}}/api/classes", auth: "{{teacherToken}}", body: { subjectName: "Data Structures", subjectCode: "CS301", semester: 3, section: "A", batch: "2022-2026" }, test: 'pm.test("Class created", () => { const json = pm.response.json(); pm.expect(json.success).to.be.true; if (json.data && json.data.classId) { pm.environment.set("classId", json.data.classId); } });' },
      { name: "20. Get My Classes (Teacher)", method: "GET", url: "{{baseUrl}}/api/classes", auth: "{{teacherToken}}", test: 'pm.test("Status 200", () => pm.response.to.have.status(200));\npm.test("Data is array", () => pm.expect(Array.isArray(pm.response.json().data)).to.be.true);\npm.test("Includes hasActiveSession", () => pm.expect(pm.response.json().data[0].hasActiveSession).to.exist);' },
      { name: "21. Get My Classes (Student)", method: "GET", url: "{{baseUrl}}/api/classes/my-classes", auth: "{{studentToken}}", test: 'pm.test("Status 200", () => pm.response.to.have.status(200));' },
      { name: "22. Get Class By ID", method: "GET", url: "{{baseUrl}}/api/classes/{{classId}}", auth: "{{teacherToken}}", test: 'pm.test("Status 200", () => pm.response.to.have.status(200));\npm.test("Has hasActiveSession", () => pm.expect(pm.response.json().data.hasActiveSession).to.exist);' },
      { name: "23. Add Students To Class", method: "POST", url: "{{baseUrl}}/api/classes/{{classId}}/students", auth: "{{teacherToken}}", body: { studentIds: ["{{studentUid}}"] }, test: 'pm.test("Status 200", () => pm.response.to.have.status(200));\npm.test("added count > 0", () => pm.expect(pm.response.json().data.added).to.be.above(0));' },
      { name: "24. Get Class Students", method: "GET", url: "{{baseUrl}}/api/classes/{{classId}}/students", auth: "{{teacherToken}}", test: 'pm.test("Status 200", () => pm.response.to.have.status(200));\npm.test("has attendance per student", () => pm.expect(pm.response.json().data[0].attendance).to.exist);' },
      { name: "25. Remove Student From Class", method: "DELETE", url: "{{baseUrl}}/api/classes/{{classId}}/students/{{studentUid}}", auth: "{{teacherToken}}", test: 'pm.test("Status 200", () => pm.response.to.have.status(200));' },
      { name: "26. Archive Class", method: "PATCH", url: "{{baseUrl}}/api/classes/{{classId}}/archive", auth: "{{teacherToken}}", test: 'pm.test("Status 200", () => pm.response.to.have.status(200));\npm.test("isActive false", () => pm.expect(pm.response.json().data.isActive).to.be.false);' }
    ]
  },
  {
    name: "━━━ FOLDER 4: 📡 Sessions ━━━",
    items: [
      { name: "27. Start Session — QR Code", method: "POST", url: "{{baseUrl}}/api/sessions/start", auth: "{{teacherToken}}", body: { classId: "{{classId}}", method: "qrcode", lateAfterMinutes: 10, autoAbsentMinutes: 5, faceRequired: false, roomNumber: "A101", buildingName: "Science Block", qrRefreshInterval: 30 }, test: 'pm.test("Session started", () => { const json = pm.response.json(); pm.expect(json.success).to.be.true; if (json.data && json.data.sessionId) { pm.environment.set("sessionId", json.data.sessionId); pm.environment.set("qrCode", json.data.qrCode); } });' },
      { name: "28. Start Session — GPS", method: "POST", url: "{{baseUrl}}/api/sessions/start", auth: "{{teacherToken}}", body: { classId: "{{classId}}", method: "gps", lateAfterMinutes: 10, teacherLat: 28.6139, teacherLng: 77.2090, radiusMeters: 50 }, test: 'pm.test("Status 201", () => pm.response.to.have.status(201));' },
      { name: "29. Start Session — WiFi", method: "POST", url: "{{baseUrl}}/api/sessions/start", auth: "{{teacherToken}}", body: { classId: "{{classId}}", method: "network", lateAfterMinutes: 10, expectedSSID: "SAAMS_CAMPUS_WIFI" }, test: 'pm.test("Status 201", () => pm.response.to.have.status(201));' },
      { name: "30. Start Session — Bluetooth", method: "POST", url: "{{baseUrl}}/api/sessions/start", auth: "{{teacherToken}}", body: { classId: "{{classId}}", method: "bluetooth", lateAfterMinutes: 10 }, test: 'pm.test("Status 201", () => pm.response.to.have.status(201));' },
      { name: "31. Get Active Session", method: "GET", url: "{{baseUrl}}/api/sessions/active/{{classId}}", auth: "{{studentToken}}", test: 'pm.test("Status 200", () => pm.response.to.have.status(200));' },
      { name: "32. Get Session Stats", method: "GET", url: "{{baseUrl}}/api/sessions/{{sessionId}}/stats", auth: "{{teacherToken}}", test: 'pm.test("Status 200", () => pm.response.to.have.status(200));\npm.test("Has stats.present", () => pm.expect(pm.response.json().data.stats.present).to.exist);' },
      { name: "33. Get My Sessions (Teacher History)", method: "GET", url: "{{baseUrl}}/api/sessions/my-sessions", auth: "{{teacherToken}}", test: 'pm.test("Status 200", () => pm.response.to.have.status(200));\npm.test("Data is array", () => pm.expect(Array.isArray(pm.response.json().data)).to.be.true);' },
      { name: "34. Refresh QR Code", method: "PATCH", url: "{{baseUrl}}/api/sessions/{{sessionId}}/refresh-qr", auth: "{{teacherToken}}", test: 'pm.test("Status 200", () => pm.response.to.have.status(200));\npm.test("has new qrCode", () => pm.expect(pm.response.json().data.qrCode).to.exist);' },
      { name: "35. End Session", method: "POST", url: "{{baseUrl}}/api/sessions/end", auth: "{{teacherToken}}", body: { sessionId: "{{sessionId}}" }, test: 'pm.test("Status 200", () => pm.response.to.have.status(200));\npm.test("has summary counts", () => pm.expect(pm.response.json().data.summary).to.exist);' }
    ]
  },
  {
    name: "━━━ FOLDER 5: ✅ Attendance ━━━",
    items: [
      { name: "36. Mark Attendance — QR Code", method: "POST", url: "{{baseUrl}}/api/attendance/mark", auth: "{{studentToken}}", body: { sessionId: "{{sessionId}}", qrCode: "{{qrCode}}", faceVerified: true, faceScore: 0.94, deviceId: "demo_device_001" }, test: 'pm.test("Attendance marked", () => { const json = pm.response.json(); pm.expect(json.success).to.be.true; if (json.data && json.data.attendanceId) { pm.environment.set("attendanceId", json.data.attendanceId); } });' },
      { name: "37. Mark Attendance — GPS", method: "POST", url: "{{baseUrl}}/api/attendance/mark", auth: "{{studentToken}}", body: { sessionId: "{{sessionId}}", studentLat: 28.6140, studentLng: 77.2091, faceVerified: true, faceScore: 0.91, deviceId: "demo_device_001" }, test: 'pm.test("Status 201", () => pm.response.to.have.status(201));' },
      { name: "38. Get Session Attendance (Live Monitor)", method: "GET", url: "{{baseUrl}}/api/attendance/session/{{sessionId}}", auth: "{{teacherToken}}", test: 'pm.test("Status 200", () => pm.response.to.have.status(200));\npm.test("has arrays", () => { const d = pm.response.json().data; pm.expect(d.present).to.exist; pm.expect(d.late).to.exist; pm.expect(d.absent).to.exist; });' },
      { name: "39. Approve Late Student", method: "PATCH", url: "{{baseUrl}}/api/attendance/{{attendanceId}}/approve", auth: "{{teacherToken}}", body: { approved: true }, test: 'pm.test("Status 200", () => pm.response.to.have.status(200));\npm.test("Status is present", () => pm.expect(pm.response.json().data.status).to.equal("present"));' },
      { name: "40. Auto Absent Late Students", method: "POST", url: "{{baseUrl}}/api/attendance/auto-absent/{{sessionId}}", auth: "{{teacherToken}}", test: 'pm.test("Status 200", () => pm.response.to.have.status(200));\npm.test("has count", () => pm.expect(pm.response.json().data.autoAbsentCount).to.exist);' },
      { name: "41. Download Excel Report", method: "GET", url: "{{baseUrl}}/api/attendance/export/class/{{classId}}", auth: "{{teacherToken}}", test: 'pm.test("Status 200", () => pm.response.to.have.status(200));\npm.test("Content-Type contains spreadsheet", () => pm.expect(pm.response.headers.get("Content-Type")).to.include("spreadsheet"));' },
      { name: "42. Download PDF Report", method: "GET", url: "{{baseUrl}}/api/attendance/export/class/{{classId}}/pdf", auth: "{{teacherToken}}", test: 'pm.test("Status 200", () => pm.response.to.have.status(200));\npm.test("Content-Type is pdf", () => pm.expect(pm.response.headers.get("Content-Type")).to.include("application/pdf"));' },
      { name: "43. Download Student Certificate", method: "GET", url: "{{baseUrl}}/api/attendance/certificate/{{studentUid}}", auth: "{{studentToken}}", test: 'pm.test("Status 200", () => pm.response.to.have.status(200));\npm.test("Content-Type is pdf", () => pm.expect(pm.response.headers.get("Content-Type")).to.include("application/pdf"));' },
      { name: "44. Download Department Excel", method: "GET", url: "{{baseUrl}}/api/attendance/export/department/{{departmentId}}", auth: "{{hodToken}}", test: 'pm.test("Status 200", () => pm.response.to.have.status(200));\npm.test("Content-Type contains spreadsheet", () => pm.expect(pm.response.headers.get("Content-Type")).to.include("spreadsheet"));' }
    ]
  },
  {
    name: "━━━ FOLDER 6: ⚖️ Disputes ━━━",
    items: [
      { name: "45. Raise Dispute", method: "POST", url: "{{baseUrl}}/api/disputes", auth: "{{studentToken}}", body: { attendanceId: "{{attendanceId}}", reason: "I was present in class but the QR code was not working on my phone. I showed my device to the teacher assistant.", evidenceNote: "Have screenshot of the error message on my phone screen" }, test: 'pm.test("Dispute raised", () => { const json = pm.response.json(); pm.expect(json.success).to.be.true; if (json.data && json.data.disputeId) { pm.environment.set("disputeId", json.data.disputeId); } });' },
      { name: "46. Get My Disputes (Student)", method: "GET", url: "{{baseUrl}}/api/disputes/my-disputes", auth: "{{studentToken}}", test: 'pm.test("Status 200", () => pm.response.to.have.status(200));\npm.test("Data is array", () => pm.expect(Array.isArray(pm.response.json().data)).to.be.true);' },
      { name: "47. Get Teacher Disputes", method: "GET", url: "{{baseUrl}}/api/disputes/teacher-disputes", auth: "{{teacherToken}}", test: 'pm.test("Status 200", () => pm.response.to.have.status(200));\npm.test("has pending array", () => pm.expect(pm.response.json().data.pending).to.exist);' },
      { name: "48. Get Teacher Disputes — Pending Only", method: "GET", url: "{{baseUrl}}/api/disputes/teacher-disputes?status=pending", auth: "{{teacherToken}}", test: 'pm.test("Status 200", () => pm.response.to.have.status(200));' },
      { name: "49. Get Dispute By ID", method: "GET", url: "{{baseUrl}}/api/disputes/{{disputeId}}", auth: "{{teacherToken}}", test: 'pm.test("Status 200", () => pm.response.to.have.status(200));\npm.test("has attendanceContext", () => pm.expect(pm.response.json().data.attendanceContext).to.exist);' },
      { name: "50. Resolve Dispute — Approve", method: "PATCH", url: "{{baseUrl}}/api/disputes/{{disputeId}}/resolve", auth: "{{teacherToken}}", body: { decision: "approved", teacherComment: "Verified with class register. Student was present. QR scan issue confirmed." }, test: 'pm.test("Status 200", () => pm.response.to.have.status(200));\npm.test("decision is approved", () => pm.expect(pm.response.json().data.decision).to.equal("approved"));' },
      { name: "51. Resolve Dispute — Reject", method: "PATCH", url: "{{baseUrl}}/api/disputes/{{disputeId}}/resolve", auth: "{{teacherToken}}", body: { decision: "rejected", teacherComment: "No supporting evidence provided. Absence stands." }, test: 'pm.test("Status 200", () => pm.response.to.have.status(200));' },
      { name: "52. Get Department Disputes (HOD)", method: "GET", url: "{{baseUrl}}/api/disputes/department-disputes", auth: "{{hodToken}}", test: 'pm.test("Status 200", () => pm.response.to.have.status(200));\npm.test("has counts", () => pm.expect(pm.response.json().data.counts).to.exist);' },
      { name: "53. Get Dispute Stats", method: "GET", url: "{{baseUrl}}/api/disputes/stats", auth: "{{teacherToken}}", test: 'pm.test("Status 200", () => pm.response.to.have.status(200));\npm.test("has pending count", () => pm.expect(pm.response.json().data.pending).to.exist);' }
    ]
  },
  {
    name: "━━━ FOLDER 7: 🔔 Notifications ━━━",
    items: [
      { name: "54. Get My Notifications", method: "GET", url: "{{baseUrl}}/api/notifications", auth: "{{teacherToken}}", test: 'pm.test("Notifications loaded", () => { const json = pm.response.json(); pm.expect(json.success).to.be.true; pm.expect(json.data).to.have.property("unreadCount"); if (json.data.notifications.length > 0) { pm.environment.set("notifId", json.data.notifications[0].notifId); } });' },
      { name: "55. Mark One Notification Read", method: "PATCH", url: "{{baseUrl}}/api/notifications/{{notifId}}/read", auth: "{{teacherToken}}", test: 'pm.test("Status 200", () => pm.response.to.have.status(200));' },
      { name: "56. Mark All Notifications Read", method: "PATCH", url: "{{baseUrl}}/api/notifications/read-all", auth: "{{teacherToken}}", test: 'pm.test("Status 200", () => pm.response.to.have.status(200));\npm.test("has updatedCount", () => pm.expect(pm.response.json().data.updatedCount).to.exist);' }
    ]
  },
  {
    name: "━━━ FOLDER 8: 👨‍💼 HOD Panel ━━━",
    items: [
      { name: "57. HOD Dashboard Overview", method: "GET", url: "{{baseUrl}}/api/hod/overview", auth: "{{hodToken}}", test: 'pm.test("Status 200", () => pm.response.to.have.status(200));\npm.test("has totalTeachers", () => pm.expect(pm.response.json().data.counts.totalTeachers).to.exist);' },
      { name: "58. Get Department Teachers", method: "GET", url: "{{baseUrl}}/api/hod/teachers", auth: "{{hodToken}}", test: 'pm.test("Status 200", () => pm.response.to.have.status(200));\npm.test("Data is array", () => pm.expect(Array.isArray(pm.response.json().data)).to.be.true);' },
      { name: "59. Add Teacher To Department", method: "POST", url: "{{baseUrl}}/api/hod/teachers", auth: "{{hodToken}}", body: { teacherId: "{{teacherUid}}" }, test: 'pm.test("Status 200", () => pm.response.to.have.status(200));' },
      { name: "60. Get Department Students", method: "GET", url: "{{baseUrl}}/api/hod/students", auth: "{{hodToken}}", test: 'pm.test("Status 200", () => pm.response.to.have.status(200));\npm.test("Data is array", () => pm.expect(Array.isArray(pm.response.json().data)).to.be.true);' },
      { name: "61. Get Department Students — Filtered", method: "GET", url: "{{baseUrl}}/api/hod/students?semester=3&section=A", auth: "{{hodToken}}", test: 'pm.test("Status 200", () => pm.response.to.have.status(200));' },
      { name: "62. Add Student To Department", method: "POST", url: "{{baseUrl}}/api/hod/students", auth: "{{hodToken}}", body: { studentId: "{{studentUid}}", semester: 3, section: "A", batch: "2022-2026" }, test: 'pm.test("Status 200", () => pm.response.to.have.status(200));' },
      { name: "63. Get Department Attendance", method: "GET", url: "{{baseUrl}}/api/hod/attendance", auth: "{{hodToken}}", test: 'pm.test("Status 200", () => pm.response.to.have.status(200));\npm.test("has departmentAverage", () => pm.expect(pm.response.json().data.departmentAverage).to.exist);' },
      { name: "64. Get Department Attendance — At Risk Only", method: "GET", url: "{{baseUrl}}/api/hod/attendance?onlyAtRisk=true", auth: "{{hodToken}}", test: 'pm.test("Status 200", () => pm.response.to.have.status(200));' },
      { name: "65. Get Department Sessions", method: "GET", url: "{{baseUrl}}/api/hod/sessions", auth: "{{hodToken}}", test: 'pm.test("Status 200", () => pm.response.to.have.status(200));' },
      { name: "66. Get Department Fraud Flags", method: "GET", url: "{{baseUrl}}/api/hod/fraud-flags", auth: "{{hodToken}}", test: 'pm.test("Status 200", () => pm.response.to.have.status(200));\npm.test("has pendingCount", () => pm.expect(pm.response.json().data.pendingCount).to.exist);' },
      { name: "67. Review Fraud Flag", method: "PATCH", url: "{{baseUrl}}/api/hod/fraud-flags/FRAUD_FLAG_ID/review", auth: "{{hodToken}}", body: { decision: "reviewed" }, test: 'pm.test("Status 200", () => pm.response.to.have.status(200));' }
    ]
  },
  {
    name: "━━━ FOLDER 9: 👑 Super Admin Panel ━━━",
    items: [
      { name: "68. System Overview Dashboard", method: "GET", url: "{{baseUrl}}/api/admin/overview", auth: "{{adminToken}}", test: 'pm.test("Status 200", () => pm.response.to.have.status(200));\npm.test("has systemCounts", () => { const d = pm.response.json().data; pm.expect(d.systemCounts).to.exist; pm.expect(d.pendingActions).to.exist; pm.expect(d.departmentBreakdown).to.exist; });' },
      { name: "69. All Departments Detailed", method: "GET", url: "{{baseUrl}}/api/admin/departments", auth: "{{adminToken}}", test: 'pm.test("Status 200", () => pm.response.to.have.status(200));\npm.test("has attendanceStats", () => pm.expect(pm.response.json().data[0].attendanceStats).to.exist);' },
      { name: "70. All Teachers", method: "GET", url: "{{baseUrl}}/api/admin/teachers", auth: "{{adminToken}}", test: 'pm.test("Status 200", () => pm.response.to.have.status(200));\npm.test("Data is array", () => pm.expect(Array.isArray(pm.response.json().data)).to.be.true);' },
      { name: "71. All Teachers — HODs Only", method: "GET", url: "{{baseUrl}}/api/admin/teachers?isHod=true", auth: "{{adminToken}}", test: 'pm.test("Status 200", () => pm.response.to.have.status(200));' },
      { name: "72. All Teachers — By Department", method: "GET", url: "{{baseUrl}}/api/admin/teachers?departmentId={{departmentId}}", auth: "{{adminToken}}", test: 'pm.test("Status 200", () => pm.response.to.have.status(200));' },
      { name: "73. All Students", method: "GET", url: "{{baseUrl}}/api/admin/students", auth: "{{adminToken}}", test: 'pm.test("Status 200", () => pm.response.to.have.status(200));' },
      { name: "74. All Students — Filter By Dept + Semester", method: "GET", url: "{{baseUrl}}/api/admin/students?departmentId={{departmentId}}&semester=3", auth: "{{adminToken}}", test: 'pm.test("Status 200", () => pm.response.to.have.status(200));' },
      { name: "75. Live Active Sessions", method: "GET", url: "{{baseUrl}}/api/admin/sessions/active", auth: "{{adminToken}}", test: 'pm.test("Status 200", () => pm.response.to.have.status(200));\npm.test("has count", () => pm.expect(pm.response.json().data.count).to.exist);' },
      { name: "76. Fraud Overview", method: "GET", url: "{{baseUrl}}/api/admin/fraud-overview", auth: "{{adminToken}}", test: 'pm.test("Status 200", () => pm.response.to.have.status(200));\npm.test("has typeBreakdown", () => pm.expect(pm.response.json().data.summary.typeBreakdown).to.exist);' },
      { name: "77. Audit Logs", method: "GET", url: "{{baseUrl}}/api/admin/audit-logs", auth: "{{adminToken}}", test: 'pm.test("Status 200", () => pm.response.to.have.status(200));\npm.test("Data is array", () => pm.expect(Array.isArray(pm.response.json().data)).to.be.true);' },
      { name: "78. Audit Logs — Filter By Action", method: "GET", url: "{{baseUrl}}/api/admin/audit-logs?action=attendance_marked", auth: "{{adminToken}}", test: 'pm.test("Status 200", () => pm.response.to.have.status(200));' },
      { name: "79. Get User Details", method: "GET", url: "{{baseUrl}}/api/admin/users/{{studentUid}}", auth: "{{adminToken}}", test: 'pm.test("Status 200", () => pm.response.to.have.status(200));\npm.test("has recentActivity", () => pm.expect(pm.response.json().data.recentActivity).to.exist);' },
      { name: "80. System Stats", method: "GET", url: "{{baseUrl}}/api/admin/stats", auth: "{{adminToken}}", test: 'pm.test("Status 200", () => pm.response.to.have.status(200));\npm.test("has stats block", () => { const d = pm.response.json().data; pm.expect(d.systemWide).to.exist; pm.expect(d.byDepartment).to.exist; });' },
      { name: "81. Pending Actions", method: "GET", url: "{{baseUrl}}/api/admin/pending-actions", auth: "{{adminToken}}", test: 'pm.test("Status 200", () => pm.response.to.have.status(200));\npm.test("has totalActionItems", () => pm.expect(pm.response.json().data.summary.totalActionItems).to.exist);' }
    ]
  },
  {
    name: "━━━ FOLDER 10: 🔒 Security Tests ━━━",
    items: [
      { name: "82. Student Cannot Access Admin", method: "GET", url: "{{baseUrl}}/api/admin/overview", auth: "{{studentToken}}", test: 'pm.test("Refused 403", () => pm.expect(pm.response.code).to.equal(403));' },
      { name: "83. Teacher Cannot Access HOD", method: "GET", url: "{{baseUrl}}/api/hod/overview", auth: "{{teacherToken}}", test: 'pm.test("Refused 403", () => pm.expect(pm.response.code).to.equal(403));' },
      { name: "84. Student Cannot Resolve Dispute", method: "PATCH", url: "{{baseUrl}}/api/disputes/{{disputeId}}/resolve", auth: "{{studentToken}}", body: { decision: "approved", teacherComment: "test" }, test: 'pm.test("Refused 403", () => pm.expect(pm.response.code).to.equal(403));' },
      { name: "85. No Token Returns 401", method: "GET", url: "{{baseUrl}}/api/auth/profile", test: 'pm.test("Refused 401", () => pm.expect(pm.response.code).to.equal(401));' },
      { name: "86. Invalid Token Returns 401", method: "GET", url: "{{baseUrl}}/api/auth/profile", auth: "invalid_token_12345", test: 'pm.test("Refused 401", () => pm.expect(pm.response.code).to.equal(401));' },
      { name: "87. Deactivated Account Returns 403", method: "POST", url: "{{baseUrl}}/api/auth/login", body: { email: "deactivated@test.com", password: "Test@123" }, test: 'pm.test("Refused 403", () => pm.expect(pm.response.code).to.equal(403));' }
    ]
  }
];

collection.item = foldersData.map(folder => ({
  name: folder.name,
  item: folder.items.map(createItem)
}));

fs.writeFileSync('SAAMS_Complete_API_Collection.json', JSON.stringify(collection, null, 2));

console.log("Successfully generated SAAMS_Complete_API_Collection.json");

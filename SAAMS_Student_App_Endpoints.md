# SAAMS Student App Endpoints Documentation

This document contains a comprehensive list of all the backend endpoints required to build and integrate the **Student App** frontend.

---

## 🔐 1. Authentication & Profile (`/api/auth`)

All routes except `register` and `login` require a valid Firebase Auth ID Token in the `Authorization: Bearer <token>` header.

### `POST /api/auth/register/student`
- **Description:** Registers a new student account.
- **Payload (Body):**
  ```json
  {
    "name": "Jane Doe",
    "email": "jane@example.com",
    "password": "strongPassword123!",
    "rollNumber": "12345",
    "phone": "9876543210",
    "semester": "6",
    "section": "A",
    "departmentId": "xyz...",
    "departmentName": "Computer Science",
    "batch": "2024",
    "fcmToken": "optional...",
    "deviceId": "optional..."
  }
  ```

### `POST /api/auth/login`
- **Description:** Authenticates a student and returns their profile.
- **Payload (Body):**
  ```json
  {
    "idToken": "<firebase_id_token>",
    "fcmToken": "optional_push_token_for_device"
  }
  ```

### `GET /api/auth/profile`
- **Description:** Fetches the logged-in student's full profile details (including the recently added `phone` field).

### `PATCH /api/auth/profile`
- **Description:** Updates the logged-in student's profile information.
- **Allowed Fields:** `name`, `phone`, `profilePhotoUrl`

### `POST /api/auth/change-password`
- **Description:** Updates the user's password.
- **Payload (Body):** `{"newPassword": "new-password"}`

### `PATCH /api/auth/fcm-token`
- **Description:** Updates the student's Firebase Cloud Messaging token for push notifications (should be called on app launch).
- **Payload (Body):** `{"fcmToken": "new_device_token"}`

### `DELETE /api/auth/account`
- **Description:** Permanently deletes the student's account.

---

## 📚 2. Classes, Enrollment & Dashboard (`/api/classes`)

### `GET /api/classes/student-dashboard`
- **Description:** 🚀 **(NEW)** A unified, real-time fetching endpoint for the student's home dashboard. It returns all classes they are enrolled in, whether each class currently has an active session (`hasActiveSession: true/false`), AND their total attendance summary stats `overallPercentage`, `totalPresent`, etc.
- **Payload:** None (Requires Authorization Header)
- **Response Example:**
  ```json
  {
    "success": true,
    "data": {
      "overallPercentage": 85,
      "totalPresent": 34,
      "totalClassesAttended": 40,
      "classes": [
        {
          "classId": "xyz123",
          "subjectName": "Data Structures",
          "subjectCode": "CS201",
          "semester": 3,
          "hasActiveSession": false,
          "attendanceSummary": {
            "present": 10,
            "late": 1,
            "absent": 2,
            "percentage": 84
          }
        }
      ]
    }
  }
  ```

### `GET /api/classes/my-classes`
- **Description:** Fetches a list of all classes the student is currently enrolled in. This fuels the student's class dashboard.

### `GET /api/classes/:classId`
- **Description:** Fetches detailed information about a specific class (like subject name, teacher name, total sessions, etc.).

---

## ⏱ 3. Sessions (`/api/sessions`)

### `GET /api/sessions/all-active` 🆕
- **Description:** Returns all active sessions across every class the student is enrolled in — in a **single request**. Ideal for a "Join Now" notification badge on the dashboard. Expired sessions are auto-ended server-side.
- **Auth:** Student token required.
- **Response Example:**
  ```json
  {
    "success": true,
    "data": [
      {
        "sessionId": "sess123",
        "classId": "class456",
        "subjectName": "Data Structures",
        "method": "qrcode",
        "status": "active",
        "startTime": "2026-03-18T05:30:00.000Z",
        "lateAfterMinutes": 10
      }
    ]
  }
  ```

### `GET /api/sessions/active/:classId`
- **Description:** Checks if a specific class currently has an ongoing active attendance session.
- **Response Info:** Returns the `sessionId`, `method` (qr, network, bluetooth, gps), and necessary configuration parameters (like `lat/lng` for GPS, `normalizedSSID` for network, etc.).

### `GET /api/sessions/:sessionId`
- **Description:** Fetches detailed information and statistics of a past session.

---

## ✅ 4. Attendance (`/api/attendance`)

### `POST /api/attendance/mark`
- **Description:** The core endpoint for a student to mark themselves present. 
- **Payload varies based on the session's `method`:**

  **For Network Method:**
  ```json
  {
    "sessionId": "abc...",
    "method": "network",
    "studentSSID": "Campus_WiFi_5G"
  }
  ```

  **For GPS Method:**
  ```json
  {
    "sessionId": "abc...",
    "method": "gps",
    "studentLat": 37.7749,
    "studentLng": -122.4194
  }
  ```

  **For QR Code Method:**
  ```json
  {
    "sessionId": "abc...",
    "method": "qrcode",
    "scannedQR": "current_qr_uuid"
  }
  ```

  **For Bluetooth Method:**
  ```json
  {
    "sessionId": "abc...",
    "method": "bluetooth",
    "deviceId": "teacher_ble_mac_address",
    "rssi": -45
  }
  ```

### `GET /api/attendance/student/me` 🆕
- **Description:** Shortcut alias — fetches **the currently logged-in student's own** attendance history without needing to know their UID. Identical response to the `:studentId` route.
- **Query Params:** `?classId=<id>` (optional, filter by class) | `?limit=50` (default 20)
- **Auth:** Student token required.

### `GET /api/attendance/student/:studentId`
- **Description:** Gets a student's attendance history by their UID. Can optionally filter by `classId` and `limit` query params.
- **Response:** Includes paginated `records` (each enriched with session details) and aggregate `stats` (`totalClasses`, `present`, `late`, `absent`, `percentage`).

### `GET /api/attendance/certificate/:studentId`
- **Description:** Downloads a formal PDF Attendance Certificate for the requested student.

---

## 📸 5. Face Verification API (`/api/face`)

*(Note: Used only if `faceRequired: true` is enabled by the teacher for a session).*

### `POST /api/face/enroll`
- **Description:** Stores a student's face descriptors in the database at registration phase or profile setup.
- **Payload:** Typically involves sending a `base64` image or face-api descriptors.

### `POST /api/face/verify`
- **Description:** Compares a live photo captured by the student app against their stored descriptor to verify identity during an active session.
- **Payload:** Usually the `sessionId` and the `image` string.

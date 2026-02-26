# 🎓 SAAMS Backend — Smart Attendance System API

**Version:** 1.0.0  
**Stack:** Node.js, Express.js, Firebase Admin SDK (Firestore & Auth), TensorFlow.js (Face-API)  
**Deployment Environment:** Render (Web Service)  

This is the central, real-time backend engine for the **Smart Attendance Application (SAAMS)**. It securely handles the heavy lifting for both the **Teacher App** and the **Student App**. It manages user authentication, class enrollments, real-time interactive lectures (sessions), anti-fraud attendance marking, biometric face verification, and analytics reporting.

---

## 🏗️ Architecture & Core Philosophy

The backend strictly adheres to a modular MVC (Model-View-Controller) architecture adapted for NoSQL:
1. **Security-First Pipeline:** Every API request passes through `cors`, `helmet` (HTTP headers), `express-rate-limit` (DDoS protection), and `authMiddleware` (Firebase JWT cryptographic validation).
2. **Dual-Collection User Stores:** Teachers and Students are logically and physically separated in the database (`teachers` vs `students` collections) to prevent permission leaking and to speed up role-specific lookups.
3. **Eventual Consistency Workarounds:** NoSQL writes can take milliseconds to propagate. The backend implements retry-loops and auto-migration interceptors to handle edge cases where frontend apps write too fast for standard reads to catch up.
4. **Thin Models, Fat Controllers:** All complex business logic (e.g., GPS distance math, attendance window overlaps, facial recognition neural nets) lives exclusively in the backend `/controllers` and `/utils`, keeping the frontend Apps lightweight and fast.

---

## 📂 Directory Structure & Detailed File Operations

### 🔹 Root Configurations
- **`index.js`**: The Application Brain. It initializes the Express server, applies security configurations, triggers the pre-loading of AI models (`initFaceApi()`), wires all 5 route modules to their `/api/*` prefixes, and registers the global fallback error handler.
- **`.env`** & **`.env.example`**: Environment variables (e.g., `PORT`, `FIREBASE_KEY_PATH`).
- **`render.yaml`**: The blueprint for Render.com. It tells Render to run `npm install`, then trigger `download-models.js`, and finally launch the server via `node index.js`.
- **`package.json`**: Dependency manifest (`express`, `firebase-admin`, `@vladmandic/face-api`, `xlsx`, etc.).

### 🔹 `/config`
- **`firebase.js`**: The Database Connector. It initializes the `firebase-admin` SDK. It has auto-detect logic: if it sees `FIREBASE_SERVICE_ACCOUNT` (production text string), it parses it. If not, it looks for a local JSON file for development. Exports the `db` (Firestore) and `auth` singletons.

### 🔹 `/middleware`
- **`authMiddleware.js` (`verifyToken`)**: **CRITICAL SECURITY COMPONENT**. 
  - Extracts the `Bearer Token` from headers.
  - Asks Google/Firebase to cryptographically verify the token.
  - Queries `teachers`, then `students` collections to find the profile.
  - **Auto-Migration Guard:** If a frontend app mistakenly writes a new user to a legacy `users` collection, this middleware intercepts it, transparently copies the data to the correct collection (`teachers` or `students`), deletes the old document, and allows the request to proceed seamlessly.
- **`errorMiddleware.js`**: Global `try/catch` fallback. Transforms raw Node.js crash objects into a standardized JSON format: `{ success: false, error: "Message", code: "SERVER_ERROR" }` to prevent leaking stack traces to the apps.

### 🔹 `/routes`
These files are simple Express `Router` definitions that map HTTP URLs to specific Node.js functions in the `/controllers`. They all sit behind `authMiddleware` (except `/api/auth/register` and `/login`).
- **`authRoutes.js`**: `/api/auth/register`, `/login`, `/profile`, `/change-password`, `/delete-account`
- **`classRoutes.js`**: `/api/classes`, `/api/classes/:classId/students`
- **`sessionRoutes.js`**: `/api/sessions/start`, `/api/sessions/end`, `/api/sessions/stats`
- **`attendanceRoutes.js`**: `/api/attendance/mark`, `/api/attendance/session/:sessionId`, `/api/attendance/export/class/:classId`
- **`faceRoutes.js`**: `/api/face/enroll`, `/api/face/verify`

### 🔹 `/controllers` (The Business Logic)
- **`authController.js`**: Creates Firebase Auth instances. Handles Role-Based Access Control (RBAC). Updates profiles and triggers last-login timestamps.
- **`classController.js`**: Manages the Class lifecycle.
  - *Synchronization Logic:* When a teacher imports 50 students via Excel, this controller doesn't just add them to the Class. It iterates over all 50 `student` documents and updates their individual `enrolledClasses` arrays using atomic `arrayUnion`. This means the Student App loads instantly—it just reads its own `enrolledClasses` array without querying the entire database.
- **`sessionController.js`**: The Engine for Lectures. 
  - Handles 4 types of sessions: **QR** (rotating cryptograms), **GPS** (lat/lng radii), **Network** (Wi-Fi SSID locking), and **Bluetooth** (BLE beacons).
  - Automatically calculates expiry times based on `lateAfterMinutes` and `autoAbsentMinutes`.
- **`attendanceController.js`**: The Anti-Fraud Agent.
  - Verifies the student is actually in the class.
  - Verifies the session hasn't expired.
  - Checks if the student already marked attendance today.
  - Calculates `lateDetection` rules.
  - Compiles raw Firestore attendance events into three-tab Excel sheets (`Summary`, `Session Stats`, `Raw Data`) via SheetJS.
- **`faceController.js`**: The Biometric Gatekeeper. 
  - Handles Student camera uploads (Base64).
  - Routes them to `faceService.js`.
  - Enrolls the resulting mathematical face map, or computes Euclidean distances to verify an identity challenge.

### 🔹 `/utils` (Stand-Alone Helpers)
- **`responseHelper.js`**: Enforces strict JSON schemas for every API endpoint. 
- **`excelGenerator.js`**: Takes raw JSON arrays, maps them to matrix arrays, creates three distinct Excel worksheets, styles the column widths, and outputs a downloadable `.xlsx` binary buffer.
- **`lateDetection.js`**: Runs Haversine formula math for GPS distance checks (calculating meters between Earth coordinates). Runs time-diff logic against Firebase Server Timestamps.
- **`faceService.js`**: Wraps the TensorFlow.js (`@tensorflow/tfjs`) engine. Loads three AI models (SSD MobileNet, Landmark68, FaceRecognitionNet) into CPU memory. Flattens base64 images onto hidden HTML5 Canvases, runs AI inference, and generates 128-float Arrays (embeddings).

---

## 🗄️ Comprehensive Database Schema (Firestore)

NoSQL databases rely heavily on data duplication (denormalization) for read speeds. This is our exact structure mapping:

### 1. `teachers` (Collection)
| Field | Type | Description |
|-------|------|-------------|
| *Document ID* | `String` | Mirrors the Firebase Auth UID |
| `name` | `String` | Full display name |
| `email` | `String` | Unique login email |
| `role` | `String` | Strictly `"teacher"` |
| `department` | `String` | e.g., "Computer Science" |
| `employeeId` | `String` | University assigned ID |
| `createdAt` | `Timestamp` | System generated |

### 2. `students` (Collection)
| Field | Type | Description |
|-------|------|-------------|
| *Document ID* | `String` | Mirrors the Firebase Auth UID |
| `name` | `String` | Full display name |
| `email` | `String` | Unique login email |
| `role` | `String` | Strictly `"student"` |
| `studentId` | `String` | University Roll Number (e.g., "1023ABC") |
| `enrolledClasses`| `Array<String>`| Array of `classId`s the student is currently taking |
| `faceDescriptor` | `Array<Number>`| 128 elements of float math (Biometric hash). Only exists after `/api/face/enroll` is called. |

### 3. `classes` (Collection)
| Field | Type | Description |
|-------|------|-------------|
| *Document ID* | `String` | Auto-generated standard Firestore ID (`classId`) |
| `teacherId` | `String` | UID of the teacher who owns this class |
| `subjectName` | `String` | e.g., "Data Structures" |
| `subjectCode` | `String` | e.g., "CS-201" |
| `students` | `Array<String>`| Array of `UID`s for enrolled students. Kept in 1:1 sync with `student.enrolledClasses`. |

### 4. `sessions` (Collection)
*A session represents a single, active lecture/class period.*
| Field | Type | Description |
|-------|------|-------------|
| *Document ID* | `String` | Auto-generated (`sessionId`) |
| `classId` | `String` | Parent class reference |
| `teacherId` | `String` | Teacher who started it |
| `method` | `String` | `qr`, `gps`, `network`, or `bluetooth` |
| `status` | `String` | `active` or `ended` |
| `startTime` | `Timestamp` | When it started |
| `qrCode` | `String` | (If QR) The current active cryptographic string |
| `lateAfterMinutes`| `Number` | Threshold before student is marked Late |

### 5. `attendance` (Collection)
*An immutable ledger of every single scan/mark.*
| Field | Type | Description |
|-------|------|-------------|
| *Document ID* | `String` | Auto-generated |
| `sessionId` | `String` | Reference to the active lecture |
| `studentId` | `String` | The UID of the student |
| `status` | `String` | `Present`, `Late`, or `Absent` |
| `method` | `String` | How they marked it (e.g. `face_verified_qr`) |
| `faceVerified` | `Boolean` | Did the neural net confirm their identity? |

---

## 🔐 API Flow & Workflow Documentation

### 1. Authentication Handshake Flow
1. Mobile App calls Firebase Client SDK `createUserWithEmailAndPassword`.
2. Mobile App gets a `JWT ID Token` from Firebase.
3. Mobile App calls Backend `/api/auth/register` passing `role="teacher"`.
4. Backend verifies the token, extracts the UID, and creates the `{name, email, role}` document directly inside the `teachers` collection.
5. All future API calls include `Authorization: Bearer <TOKEN>`.
6. **Graceful Degradation:** If the frontend is outdated and creates a profile manually in the `users` collection, the Backend's `verifyToken` middleware dynamically detects this, moves the JSON blob into `teachers` or `students`, formats it, and continues.

### 2. Session & Attendance Flow
1. Teacher hits `POST /api/sessions/start`. Backend creates a Session Document (`status: active`).
2. If it's a QR session, the backend generates an `initialQrString`.
3. Student App hits `POST /api/attendance/mark` containing:
   - `sessionId`
   - `qrCode` (scanned from teacher's phone)
   - `faceImage` (base64 photo taken from front camera)
4. Frontend logic triggers Backend calculations:
   - Does `qrCode` exactly match the active one in DB? *(Fails if teacher refreshed it).*
   - Does the student's `faceImage` match their `faceDescriptor` generated on day 1 with Euclidean math `< 0.55`?
   - Is `currentTime` > `startTime + lateAfterMinutes`? *(Marks Late).*
5. Backend writes immutable `attendance` document. Returns `Success`.

### 3. Reporting & Excel Flow
1. Teacher clicks "Export Class Data".
2. Hits `GET /api/attendance/export/class/:classId`.
3. `attendanceController` gathers:
   - The `classes` document (to get roster).
   - All `students` documents linked to the class.
   - All `sessions` documents that ever existed for this class.
   - Every single `attendance` document linked to those sessions.
4. It builds a massive 2D memory array in Node.js.
5. Passes it to `excelGenerator.js` via SheetJS.
6. Streams a `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` binary directly to the Teacher's phone for saving/sharing.

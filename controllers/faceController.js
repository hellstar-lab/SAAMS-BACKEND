/**
 * faceController.js
 * Handles face enrollment and verification for SAAMS students.
 *
 * POST /api/face/enroll  — save a student's face descriptor
 * POST /api/face/verify  — compare a live photo against stored descriptor
 */

import { db } from '../config/firebase.js'
import { successResponse, errorResponse } from '../utils/responseHelper.js'
import { getDescriptorFromBase64, euclideanDistance } from '../utils/faceService.js'

// Distance threshold: < 0.55 → same person
const MATCH_THRESHOLD = 0.55

// ── ENROLL FACE ───────────────────────────────────────────────────────────────
// POST /api/face/enroll
export const enrollFace = async (req, res) => {
    try {
        const { studentId, faceImage } = req.body

        // 1. Validate input
        if (!studentId || !faceImage) {
            return errorResponse(res, 'studentId and faceImage are required', 400, 'VALIDATION_ERROR')
        }

        // 2. Look up student document by their DB studentId field (e.g. "CS101")
        //    OR by Firebase UID (if studentId is a UID)
        let studentRef, studentData

        // First try matching by Firebase UID directly
        const uidDoc = await db.collection('students').doc(studentId).get()
        if (uidDoc.exists) {
            studentRef = uidDoc.ref
            studentData = uidDoc.data()
        } else {
            // Fall back: search by studentId field value
            const snap = await db.collection('students')
                .where('studentId', '==', studentId)
                .limit(1)
                .get()

            if (snap.empty) {
                return errorResponse(res, 'Student not found', 404, 'STUDENT_NOT_FOUND')
            }
            studentRef = snap.docs[0].ref
            studentData = snap.docs[0].data()
        }

        // 3. Extract face descriptor from the base64 image
        let descriptor
        try {
            descriptor = await getDescriptorFromBase64(faceImage)
        } catch (e) {
            console.error('enrollFace descriptor error:', e)
            return errorResponse(res, 'Could not process image', 400, 'IMAGE_PROCESSING_ERROR')
        }

        if (!descriptor) {
            return errorResponse(res, 'No face detected in image', 400, 'NO_FACE_DETECTED')
        }

        // 4. Store the descriptor as a plain array in Firestore
        await studentRef.update({
            faceDescriptor: Array.from(descriptor),
            faceEnrolledAt: new Date().toISOString()
        })

        return successResponse(res, { message: 'Face enrolled successfully' })

    } catch (error) {
        console.error('enrollFace error:', error)
        return errorResponse(res, 'Failed to enroll face', 500, 'SERVER_ERROR')
    }
}

// ── VERIFY FACE ───────────────────────────────────────────────────────────────
// POST /api/face/verify
export const verifyFace = async (req, res) => {
    try {
        const { studentId, faceImage } = req.body

        // 1. Validate input
        if (!studentId || !faceImage) {
            return errorResponse(res, 'studentId and faceImage are required', 400, 'VALIDATION_ERROR')
        }

        // 2. Fetch the student's stored face descriptor
        let storedDescriptor

        const uidDoc = await db.collection('students').doc(studentId).get()
        if (uidDoc.exists && uidDoc.data().faceDescriptor) {
            storedDescriptor = uidDoc.data().faceDescriptor
        } else {
            // Try studentId field lookup
            const snap = await db.collection('students')
                .where('studentId', '==', studentId)
                .limit(1)
                .get()

            if (snap.empty) {
                return errorResponse(res, 'Student not found', 404, 'STUDENT_NOT_FOUND')
            }

            const studentData = snap.docs[0].data()
            if (!studentData.faceDescriptor) {
                return errorResponse(res, 'Face not enrolled for this student', 400, 'NOT_ENROLLED')
            }

            storedDescriptor = studentData.faceDescriptor
        }

        // Confirm stored descriptor has the faceDescriptor field
        if (!storedDescriptor || !Array.isArray(storedDescriptor)) {
            return errorResponse(res, 'Face not enrolled for this student', 400, 'NOT_ENROLLED')
        }

        // 3. Extract live face descriptor from the provided image
        let liveDescriptor
        try {
            liveDescriptor = await getDescriptorFromBase64(faceImage)
        } catch (e) {
            console.error('verifyFace descriptor error:', e)
            return errorResponse(res, 'Could not process image', 400, 'IMAGE_PROCESSING_ERROR')
        }

        if (!liveDescriptor) {
            return errorResponse(res, 'No face detected in image', 400, 'NO_FACE_DETECTED')
        }

        // 4. Compute Euclidean distance between stored and live descriptors
        const distance = euclideanDistance(
            new Float32Array(storedDescriptor),
            liveDescriptor
        )

        const match = distance < MATCH_THRESHOLD
        // Similarity score: clamp to [0,1] range, higher = more similar
        const score = Math.max(0, Math.min(1, parseFloat((1 - distance).toFixed(4))))

        return successResponse(res, {
            match,
            score,
            distance: parseFloat(distance.toFixed(4))
        })

    } catch (error) {
        console.error('verifyFace error:', error)
        return errorResponse(res, 'Failed to verify face', 500, 'SERVER_ERROR')
    }
}

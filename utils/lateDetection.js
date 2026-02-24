// ─── Late Detection Utility ────────────────────────────────────────────────────

/**
 * Determines if a student joined after the allowed late window.
 */
export const isStudentLate = (sessionStartTime, joinTime, lateAfterMinutes) => {
    const startMs = sessionStartTime?.toMillis
        ? sessionStartTime.toMillis()
        : new Date(sessionStartTime).getTime()
    const joinMs = joinTime?.toMillis
        ? joinTime.toMillis()
        : new Date(joinTime).getTime()
    const diffMinutes = (joinMs - startMs) / (1000 * 60)
    return diffMinutes > lateAfterMinutes
}

/**
 * Returns formatted session duration given start and end times.
 */
export const getSessionDuration = (startTime, endTime) => {
    const startMs = startTime?.toMillis
        ? startTime.toMillis()
        : new Date(startTime).getTime()
    const endMs = endTime?.toMillis
        ? endTime.toMillis()
        : new Date(endTime).getTime()
    const diffMs = endMs - startMs
    const minutes = Math.floor(diffMs / (1000 * 60))
    const hours = Math.floor(minutes / 60)
    const remainingMins = minutes % 60
    return {
        totalMinutes: minutes,
        formatted: hours > 0 ? `${hours}h ${remainingMins}m` : `${minutes}m`
    }
}

/**
 * Generates a unique session/QR code string.
 */
export const generateSessionCode = () => {
    const timestamp = Date.now().toString(36)
    const random = Math.random().toString(36).substring(2, 10)
    return `session_${timestamp}_${random}`
}

/**
 * Checks if a session has exceeded its max allowed duration.
 */
export const isSessionExpired = (startTime, maxDurationMinutes = 180) => {
    const startMs = startTime?.toMillis
        ? startTime.toMillis()
        : new Date(startTime).getTime()
    const diffMinutes = (Date.now() - startMs) / (1000 * 60)
    return diffMinutes > maxDurationMinutes
}

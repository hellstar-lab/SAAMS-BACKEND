import { randomUUID } from 'crypto'

// WHY: Every unhandled error gets a unique ID for server-side correlation without leaking internals to clients
export const errorMiddleware = (err, req, res, next) => {
    const requestId = randomUUID()

    // WHY: Always log full stack server-side for debugging
    console.error(`[${requestId}] Unhandled error on ${req.method} ${req.originalUrl}:`, err)

    // WHY: Detect Firestore / Firebase connection errors and return 503 instead of generic 500
    const isDbError = err.code === 'UNAVAILABLE' || err.code === 'DEADLINE_EXCEEDED' ||
                      (err.message && err.message.toLowerCase().includes('firestore'))
    if (isDbError) {
        return res.status(503).json({
            success: false,
            error: 'Service temporarily unavailable. Please retry.',
            code: 'DB_UNAVAILABLE',
            request_id: requestId
        })
    }

    // WHY: Timeout errors from connect-timeout middleware
    if (err.status === 503 && err.timeout) {
        return res.status(504).json({
            success: false,
            error: 'Request timed out. Please retry.',
            code: 'GATEWAY_TIMEOUT',
            request_id: requestId
        })
    }

    const statusCode = err.statusCode || err.status || 500

    // WHY: In production, NEVER expose raw error messages or stack traces to the client
    const isProduction = process.env.NODE_ENV === 'production'
    const clientMessage = (isProduction && statusCode === 500)
        ? 'Internal server error'
        : (err.message || 'Internal server error')

    res.status(statusCode).json({
        success: false,
        error: clientMessage,
        code: err.code || 'SERVER_ERROR',
        request_id: requestId  // WHY: Client can share this ID with support for log correlation
    })
}

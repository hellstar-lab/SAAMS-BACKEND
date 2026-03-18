// WHY: Prevents RAM spikes when all 100 users hit the server simultaneously
// by limiting how many requests are actively processed at once.

const MAX_CONCURRENT = 20       // WHY: 20 concurrent keeps memory safely under 512 MB
const QUEUE_TIMEOUT_MS = 10000  // WHY: 10 s is long enough to absorb burst, not enough to frustrate

let activeRequests = 0
const waitQueue = []

function acquireSlot(res, next) {
    activeRequests++
    let released = false

    // WHY: Use a single idempotent release function attached once to the relevant events
    function release() {
        if (released) return
        released = true
        if (waitQueue.length > 0) {
            // WHY: Hand the slot directly to the next waiter without decrementing first
            const nextGrant = waitQueue.shift()
            nextGrant() // resolve the waiting closure
        } else {
            activeRequests--
        }
    }

    res.on('finish', release)
    res.on('close', release)
    next()
}

export function concurrencyMiddleware(req, res, next) {
    // WHY: Skip the semaphore for health checks — they must always be responsive
    // for Render's uptime monitoring and don't need RAM protection
    if (req.path === '/health') return next()

    if (activeRequests < MAX_CONCURRENT) {
        return acquireSlot(res, next)
    }

    // WHY: No slot available — queue the request with a timeout
    let resolved = false

    const grantSlot = () => {
        if (resolved) return
        resolved = true
        acquireSlot(res, next)
    }

    waitQueue.push(grantSlot)

    // WHY: If the request waits longer than 10 s, reject it rather than hanging forever
    setTimeout(() => {
        if (!resolved) {
            resolved = true
            const idx = waitQueue.indexOf(grantSlot)
            if (idx !== -1) waitQueue.splice(idx, 1)
            res.status(429).json({
                success: false,
                error: 'server busy',
                retry_after: 10
            })
        }
    }, QUEUE_TIMEOUT_MS)
}

// WHY: Exported for the /health endpoint to report real-time capacity stats
export function getConcurrencyStats() {
    return { activeRequests, queuedRequests: waitQueue.length, maxConcurrent: MAX_CONCURRENT }
}

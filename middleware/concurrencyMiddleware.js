// WHY: Prevents RAM spikes when all 100 users hit the server simultaneously
// by limiting how many requests are actively processed at once.

const MAX_CONCURRENT = 20       // WHY: 20 concurrent keeps memory safely under 512 MB
const QUEUE_TIMEOUT_MS = 10000  // WHY: 10 s is long enough to absorb burst, not enough to frustrate

let activeRequests = 0
const waitQueue = []

function releaseSlot() {
    // WHY: Process the next waiting request as soon as a slot opens
    if (waitQueue.length > 0) {
        const next = waitQueue.shift()
        next() // resolve the waiting promise
    } else {
        activeRequests--
    }
}

export function concurrencyMiddleware(req, res, next) {
    if (activeRequests < MAX_CONCURRENT) {
        // WHY: Slot available — increment and proceed immediately
        activeRequests++
        res.on('finish', releaseSlot)
        res.on('close', releaseSlot)
        return next()
    }

    // WHY: No slot available — queue the request with a timeout
    let resolved = false
    const grantSlot = () => {
        if (resolved) return
        resolved = true
        // WHY: We already occupied the slot when we dequeued, so just continue
        res.on('finish', releaseSlot)
        res.on('close', releaseSlot)
        next()
    }

    waitQueue.push(grantSlot)

    // WHY: If the request waits longer than 10 s, reject it rather than hanging forever
    setTimeout(() => {
        if (!resolved) {
            resolved = true
            const idx = waitQueue.indexOf(grantSlot)
            if (idx !== -1) waitQueue.splice(idx, 1)
            // WHY: Do NOT decrement activeRequests — this slot was never granted
            res.status(429).json({
                success: false,
                error: 'server busy',
                retry_after: 10
            })
        }
    }, QUEUE_TIMEOUT_MS)
}

// Export diagnostic function for /health endpoint
export function getConcurrencyStats() {
    return { activeRequests, queuedRequests: waitQueue.length, maxConcurrent: MAX_CONCURRENT }
}

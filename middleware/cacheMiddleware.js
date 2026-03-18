// WHY: In-memory LRU cache prevents redundant Firestore reads for read-only,
// non-user-specific endpoints, reducing DB load and improving response time.

import { LRUCache } from 'lru-cache'

const cache = new LRUCache({
    max: 100,                   // WHY: Cap at 100 entries — each entry is small JSON; stays well under 10 MB
    ttl: 60 * 1000,            // WHY: 60 second TTL — data stays fresh enough for listing endpoints
    allowStale: false,          // WHY: Never serve truly expired data
    updateAgeOnGet: false       // WHY: TTL should be wall-clock based, not sliding
})

/**
 * Middleware factory. Wrap a route with this to enable LRU caching.
 * Usage: router.get('/departments', cacheEndpoint(), getDepartments)
 *
 * WHY: cache-aside pattern — check cache, miss → query DB → store → return
 */
export function cacheEndpoint(ttlOverrideMs = null) {
    return (req, res, next) => {
        // WHY: Only cache GET requests — mutations must never be cached
        if (req.method !== 'GET') return next()

        // WHY: Never cache user-specific data that snuck past route selection
        if (req.user && req.query.scope === 'me') return next()

        const key = req.originalUrl

        if (cache.has(key)) {
            const cached = cache.get(key)
            // WHY: Inform clients they can also cache this data locally for 60 s
            res.setHeader('Cache-Control', 'public, max-age=60')
            res.setHeader('X-Cache', 'HIT')
            return res.status(200).json(cached)
        }

        // WHY: Intercept res.json to capture the response for caching before sending
        const originalJson = res.json.bind(res)
        res.json = (body) => {
            // WHY: Only cache successful responses
            if (res.statusCode === 200 && body && body.success !== false) {
                cache.set(key, body, ttlOverrideMs ? { ttl: ttlOverrideMs } : undefined)
                res.setHeader('Cache-Control', 'public, max-age=60')
                res.setHeader('X-Cache', 'MISS')
            }
            return originalJson(body)
        }

        next()
    }
}

export function clearCache(urlPattern = null) {
    if (!urlPattern) {
        cache.clear()
    } else {
        for (const key of cache.keys()) {
            if (key.includes(urlPattern)) cache.delete(key)
        }
    }
}

export function getCacheStats() {
    return { size: cache.size, max: cache.max }
}

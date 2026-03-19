# Resolve ERR_ERL_UNEXPECTED_X_FORWARDED_FOR Error

This error is occurring because the Render reverse proxy sends the `X-Forwarded-For` header, but Express's trust proxy setting is false by default. This causes `express-rate-limit` to throw a `ValidationError` on every request.

## Proposed Changes

### Backend Core
Modify the main Express application setup to explicitly trust the proxy.

#### [MODIFY] index.js
Add `app.set('trust proxy', 1);` immediately after `const app = express();`.

## Verification Plan

### Automated Tests
Run a local test snippet to verify the server starts without a `ValidationError`.

### Manual Verification
1. Push the code to Render.
2. Verify the `/health` endpoint returns a 200 OK status.

# Connecting to Cloud-Hosted Foundry (The Forge)

## The Problem

Foundry VTT's Socket.io server is designed for browser-to-server communication, not external Python clients. Cloud hosting services like The Forge add additional security layers that prevent direct Socket.io connections from external applications.

## Solutions

### Option 1: HTTP API Endpoint (Recommended)

The Foundry module can expose an HTTP endpoint that accepts POST requests. However, Foundry doesn't natively support custom HTTP routes in modules, so we need a workaround.

**Implementation:**
1. Create a simple HTTP proxy server that:
   - Listens for POST requests from Rollsight
   - Forwards them to Foundry via Socket.io or hooks
   - Runs on the same machine as the browser accessing Foundry

2. Or use a browser extension that:
   - Intercepts HTTP requests
   - Forwards them to Foundry's module system

### Option 2: Browser Bridge Extension

Create a browser extension that:
- Runs in the browser when Foundry is open
- Receives HTTP requests from Rollsight (via localhost)
- Forwards them to Foundry's module via Socket.io

### Option 3: Webhook Proxy Service

Use a webhook proxy service that:
- Receives HTTP POST from Rollsight
- Connects to Foundry via browser automation
- Injects JavaScript to trigger module events

### Option 4: Foundry Module API (If Available)

Some Foundry hosting services provide API access. Check if The Forge offers:
- REST API endpoints
- Webhook support
- Custom module API access

## Current Implementation

The current code attempts:
1. **HTTP Connection Test**: Tests if the server is reachable via HTTP
2. **Socket.io Fallback**: Falls back to Socket.io for self-hosted instances
3. **Error Handling**: Provides clear error messages

## Recommended Next Steps

1. **Check The Forge Documentation**: See if they offer API access or webhook support
2. **Browser Extension**: Create a simple browser extension that bridges HTTP to Socket.io
3. **Local Proxy**: Run a local proxy server that forwards HTTP to Foundry

## Temporary Workaround

For now, you can:
1. Use the webhook server for roll requests (Foundry → Rollsight)
2. For sending rolls (Rollsight → Foundry), you may need to:
   - Use a browser extension
   - Or manually copy/paste roll results
   - Or wait for a proper API solution

## Future Improvements

- Browser extension for HTTP-to-Socket.io bridging
- Foundry module API endpoint (if Foundry adds support)
- Webhook proxy service
- Direct API integration (if The Forge provides it)










# Maharishi Google Login Backend

A Node.js/Express backend server that enables Google OAuth 2.0 authentication with automatic Shopify store login via Multipass tokens.

## Overview

This application provides a seamless authentication flow where users can sign in using their Google account and are automatically logged into a Shopify store using Shopify's Multipass authentication system. This eliminates the need for users to create separate accounts for your Shopify store.

## Features

- **Google OAuth 2.0 Integration**: Secure authentication using Google's OAuth 2.0 authorization code flow
- **Shopify Multipass Authentication**: Automatic customer account creation/login in Shopify stores
- **CSRF Protection**: State parameter validation to prevent cross-site request forgery attacks
- **CORS Configuration**: Configurable cross-origin resource sharing for frontend integration
- **Error Handling**: Graceful error handling with redirects to Shopify login page on failures
- **State Cleanup**: Automatic cleanup of expired authorization states (10-minute expiry)
- **Health Check Endpoint**: Monitor server status

## Prerequisites

- Node.js (ES modules support required)
- Google Cloud Project with OAuth 2.0 credentials
- Shopify store with Multipass enabled
- Shopify Multipass secret key

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd google-login
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file in the project root with the following environment variables:
```env
SHOPIFY_SHOP_DOMAIN=your-shop.myshopify.com
SHOPIFY_MULTIPASS_SECRET=your-multipass-secret
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_REDIRECT_URI=http://localhost:3001/auth/google/callback
PORT=3001
POST_LOGIN_REDIRECT=/account
ALLOWED_ORIGINS=http://localhost:3000,https://your-frontend-domain.com
```

## Environment Variables

### Required Variables

| Variable | Description |
|----------|-------------|
| `SHOPIFY_SHOP_DOMAIN` | Your Shopify store domain (e.g., `your-shop.myshopify.com`) |
| `SHOPIFY_MULTIPASS_SECRET` | Shopify Multipass secret key from your Shopify admin |
| `GOOGLE_CLIENT_ID` | Google OAuth 2.0 client ID from Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | Google OAuth 2.0 client secret from Google Cloud Console |
| `GOOGLE_REDIRECT_URI` | The callback URL registered with Google (must match exactly) |

### Optional Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Port number for the server |
| `POST_LOGIN_REDIRECT` | `/account` | Path to redirect users after successful login |
| `ALLOWED_ORIGINS` | (empty) | Comma-separated list of allowed CORS origins |

## Configuration

### Google OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable Google+ API:
   - Navigate to "APIs & Services" > "Library"
   - Search for "Google+ API" and enable it
4. Configure OAuth 2.0 consent screen:
   - Go to "APIs & Services" > "OAuth consent screen"
   - Fill in the required information
5. Create OAuth 2.0 credentials:
   - Go to "APIs & Services" > "Credentials"
   - Click "Create Credentials" > "OAuth client ID"
   - Application type: Web application
   - Authorized redirect URI: `http://localhost:3001/auth/google/callback` (or your production URL)
6. Copy the Client ID and Client Secret to your `.env` file

### Shopify Multipass Setup

1. Log in to your Shopify admin
2. Go to Settings > Checkout > Customer accounts
3. Ensure customer accounts are enabled
4. Generate a Multipass secret:
   - The secret is typically found in Shopify admin under Settings > Checkout
   - Or use Shopify's Multipass secret generation tool
5. Copy the secret to your `.env` file

## Usage

### Development Mode

Run the server with file watching for automatic restarts on changes:
```bash
npm run dev
```

### Production Mode

Start the server:
```bash
npm start
```

The server will start on the specified port (default: 3001).

## API Endpoints

### GET `/`
Returns API information and available endpoints.

**Response:**
```json
{
  "success": true,
  "name": "Maharishi Google Login Backend",
  "endpoints": {
    "authorize": "/auth/google",
    "callback": "/auth/google/callback",
    "health": "/health"
  }
}
```

### GET `/health`
Health check endpoint to verify server status.

**Response:**
```json
{
  "success": true,
  "status": "ok"
}
```

### GET `/auth/google`
Initiates the Google OAuth 2.0 authorization flow.

**Query Parameters:**
- `return_to` (optional): Path to redirect after successful login (default: `/account`)

**Behavior:**
- Generates a random state token for CSRF protection
- Stores the state and return path in memory
- Redirects user to Google's authorization page

### GET `/auth/google/callback`
Handles the OAuth callback from Google.

**Query Parameters:**
- `code`: Authorization code from Google
- `state`: State token for CSRF validation
- `error`: Error code if authorization was denied

**Behavior:**
- Validates the state token and checks for expiration
- Exchanges authorization code for access token
- Fetches user profile information from Google
- Validates email presence and verification status
- Generates Shopify Multipass token with user data
- Redirects user to Shopify store with Multipass login URL

**Error Handling:**
- On error, redirects to Shopify login page with error message
- Errors include: missing parameters, invalid/expired state, token exchange failures, unverified email

## Authentication Flow

1. User clicks "Login with Google" on your frontend
2. Frontend redirects to `/auth/google?return_to=/desired/path`
3. Server generates state token and redirects to Google OAuth page
4. User authorizes the application on Google
5. Google redirects to `/auth/google/callback` with authorization code
6. Server validates state and exchanges code for access token
7. Server fetches user profile from Google
8. Server generates Shopify Multipass token with user data
9. Server redirects user to Shopify store with Multipass URL
10. Shopify creates/updates customer account and logs them in
11. User is redirected to the specified return path

## Security Features

- **State Parameter Validation**: Prevents CSRF attacks by validating OAuth state tokens
- **State Expiration**: Authorization states expire after 10 minutes
- **Automatic Cleanup**: Expired states are cleaned up every 60 seconds
- **CORS Protection**: Configurable allowed origins for API access
- **Email Verification**: Only allows verified Google email addresses
- **HTTPS Recommended**: Use HTTPS in production for secure token transmission

## CORS Configuration

The server uses a flexible CORS policy that allows:
- Configured origins from `ALLOWED_ORIGINS` environment variable
- Any `.myshopify.com` subdomain
- Local development on `localhost` or `127.0.0.1`

If `ALLOWED_ORIGINS` is empty, all origins are allowed (not recommended for production).

## Error Handling

The server handles errors gracefully:

- **OAuth Callback Errors**: Redirects to Shopify login page with error message
- **API Errors**: Returns JSON response with error details
- **Validation Errors**: Clear error messages for missing/invalid data

Common error scenarios:
- Missing environment variables (server won't start)
- Invalid/expired authorization state
- Google authentication denied by user
- Unverified Google email address
- Missing email in Google profile
- Token exchange failures

## Deployment

### Production Considerations

1. **Environment Variables**: Ensure all required environment variables are set in your production environment
2. **HTTPS**: Use HTTPS for all OAuth callbacks and API calls
3. **Domain Configuration**: Update `GOOGLE_REDIRECT_URI` to your production domain
4. **CORS Origins**: Configure `ALLOWED_ORIGINS` with your production frontend domain
5. **Process Manager**: Use a process manager like PM2 for production deployments:
```bash
npm install -g pm2
pm2 start server.js --name google-login
```

### Example Deployment with PM2

```bash
# Install PM2 globally
npm install -g pm2

# Start the application
pm2 start server.js --name google-login

# Configure PM2 to start on system boot
pm2 startup
pm2 save

# View logs
pm2 logs google-login

# Monitor application
pm2 monit
```

## Troubleshooting

### Server won't start
- Check that all required environment variables are set in `.env`
- Verify Node.js version supports ES modules (Node.js 12+)
- Check if the specified port is already in use

### Google OAuth errors
- Verify `GOOGLE_REDIRECT_URI` matches exactly in Google Cloud Console
- Ensure Google+ API is enabled in your Google Cloud project
- Check that the OAuth consent screen is properly configured

### Shopify Multipass errors
- Verify `SHOPIFY_MULTIPASS_SECRET` is correct
- Ensure Multipass is enabled in your Shopify store settings
- Check that `SHOPIFY_SHOP_DOMAIN` is correct

### CORS errors
- Verify your frontend domain is in `ALLOWED_ORIGINS`
- Check that the origin header is being sent from your frontend
- Ensure your frontend is using the correct protocol (http vs https)

## Dependencies

- `express`: ^4.21.2 - Web framework
- `cors`: ^2.8.5 - CORS middleware
- `dotenv`: ^16.4.7 - Environment variable management

## License

Private

## Support

For issues or questions, please contact the development team.

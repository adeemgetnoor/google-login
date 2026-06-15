import crypto from 'node:crypto';
import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';

dotenv.config();

const application = express();
const port = Number(process.env.PORT || 3001);
const shopifyShopDomain = process.env.SHOPIFY_SHOP_DOMAIN;
const shopifyMultipassSecret = process.env.SHOPIFY_MULTIPASS_SECRET;
const googleClientIdentifier = process.env.GOOGLE_CLIENT_ID;
const googleClientSecretKey = process.env.GOOGLE_CLIENT_SECRET;
const googleRedirectUri = process.env.GOOGLE_REDIRECT_URI;
const shopifyStoreUrl = `https://${shopifyShopDomain}`;
const postLoginRedirectPath = process.env.POST_LOGIN_REDIRECT || '/account';
const allowedOrigins = String(process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const requiredEnvironment = [
  ['SHOPIFY_SHOP_DOMAIN', shopifyShopDomain],
  ['SHOPIFY_MULTIPASS_SECRET', shopifyMultipassSecret],
  ['GOOGLE_CLIENT_ID', googleClientIdentifier],
  ['GOOGLE_CLIENT_SECRET', googleClientSecretKey],
  ['GOOGLE_REDIRECT_URI', googleRedirectUri]
];

const missingEnvironment = requiredEnvironment
  .filter((entry) => !entry[1])
  .map((entry) => entry[0]);

missingEnvironment.length && (() => {
  throw new Error(`Missing environment variables: ${missingEnvironment.join(', ')}`);
})();

function isAllowedOrigin(origin) {
  return !origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin) || origin.endsWith('.myshopify.com') || /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);
}

const corsConfiguration = {
  origin(origin, callback) {
    const allowed = isAllowedOrigin(origin);
    callback(null, allowed ? origin : false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  preflightContinue: false,
  optionsSuccessStatus: 204
};

application.use(cors(corsConfiguration));
application.options('*', cors(corsConfiguration));
application.use(express.json());
application.use(express.urlencoded({ extended: true }));

const googleAuthorizationEndpoint = 'https://accounts.google.com/o/oauth2/v2/auth';
const googleTokenEndpoint = 'https://oauth2.googleapis.com/token';
const googleUserInfoEndpoint = 'https://www.googleapis.com/oauth2/v2/userinfo';

const pendingAuthorizationStates = new Map();

function createApplicationError(message, statusCode, details) {
  const error = new Error(message);
  error.status = statusCode;
  error.details = details;
  return error;
}

function generateRandomStateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function buildGoogleAuthorizationUrl(stateToken) {
  const queryParameters = new URLSearchParams({
    client_id: googleClientIdentifier,
    redirect_uri: googleRedirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state: stateToken,
    access_type: 'offline',
    prompt: 'select_account'
  });
  return `${googleAuthorizationEndpoint}?${queryParameters.toString()}`;
}

async function exchangeGoogleAuthorizationCode(authorizationCode) {
  const response = await fetch(googleTokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: authorizationCode,
      client_id: googleClientIdentifier,
      client_secret: googleClientSecretKey,
      redirect_uri: googleRedirectUri,
      grant_type: 'authorization_code'
    }).toString()
  });
  const tokenPayload = await response.json();
  return response.ok ? tokenPayload : Promise.reject(createApplicationError('Google token exchange failed', 401, tokenPayload));
}

async function fetchGoogleUserProfile(accessToken) {
  const response = await fetch(googleUserInfoEndpoint, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const userProfile = await response.json();
  return response.ok ? userProfile : Promise.reject(createApplicationError('Failed to fetch Google user profile', 401, userProfile));
}

function generateMultipassToken(customerData) {
  const secretKeyHash = crypto.createHash('sha256').update(shopifyMultipassSecret).digest();
  const encryptionKey = secretKeyHash.subarray(0, 16);
  const signingKey = secretKeyHash.subarray(16, 32);

  const customerJsonString = JSON.stringify(customerData);
  const initializationVector = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-128-cbc', encryptionKey, initializationVector);
  const encryptedData = Buffer.concat([
    initializationVector,
    cipher.update(customerJsonString, 'utf8'),
    cipher.final()
  ]);

  const signature = crypto.createHmac('sha256', signingKey).update(encryptedData).digest();
  const tokenBuffer = Buffer.concat([encryptedData, signature]);

  return tokenBuffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
}

function buildMultipassLoginUrl(emailAddress, firstName, lastName, returnPath) {
  const customerData = {
    email: emailAddress,
    first_name: firstName || '',
    last_name: lastName || '',
    return_to: shopifyStoreUrl + returnPath,
    created_at: new Date().toISOString()
  };
  const token = generateMultipassToken(customerData);
  return `${shopifyStoreUrl}/account/login/multipass/${token}`;
}

function cleanupExpiredAuthorizationStates() {
  const expirationThreshold = Date.now() - 600000;
  pendingAuthorizationStates.forEach((stateValue, stateKey) => {
    stateValue.createdAt < expirationThreshold && pendingAuthorizationStates.delete(stateKey);
  });
}

application.get('/', (request, response) => {
  response.json({
    success: true,
    name: 'Maharishi Google Login Backend',
    endpoints: {
      authorize: '/auth/google',
      callback: '/auth/google/callback',
      health: '/health'
    }
  });
});

application.get('/health', (request, response) => {
  response.json({ success: true, status: 'ok' });
});

application.get('/auth/google', (request, response) => {
  const stateToken = generateRandomStateToken();
  const returnPath = String(request.query.return_to || postLoginRedirectPath);
  pendingAuthorizationStates.set(stateToken, {
    returnPath: returnPath,
    createdAt: Date.now()
  });
  const authorizationUrl = buildGoogleAuthorizationUrl(stateToken);
  response.redirect(authorizationUrl);
});

application.get('/auth/google/callback', async (request, response, next) => {
  try {
    const authorizationCode = request.query.code;
    const stateToken = request.query.state;
    const googleErrorCode = request.query.error;

    googleErrorCode && (() => {
      throw createApplicationError(`Google authentication was denied: ${googleErrorCode}`, 400);
    })();

    (!authorizationCode || !stateToken) && (() => {
      throw createApplicationError('Missing authorization code or state parameter', 400);
    })();

    const pendingState = pendingAuthorizationStates.get(stateToken);

    !pendingState && (() => {
      throw createApplicationError('Invalid or expired authorization state', 400);
    })();

    pendingAuthorizationStates.delete(stateToken);

    const isStateExpired = (Date.now() - pendingState.createdAt) > 600000;
    isStateExpired && (() => {
      throw createApplicationError('Authorization state has expired', 400);
    })();

    const tokenPayload = await exchangeGoogleAuthorizationCode(authorizationCode);
    const googleUserProfile = await fetchGoogleUserProfile(tokenPayload.access_token);

    const emailAddress = googleUserProfile.email;
    const firstName = googleUserProfile.given_name || googleUserProfile.name || '';
    const lastName = googleUserProfile.family_name || '';

    !emailAddress && (() => {
      throw createApplicationError('Google account does not have an email address', 422);
    })();

    !googleUserProfile.verified_email && (() => {
      throw createApplicationError('Google email address is not verified', 422);
    })();

    const returnPath = pendingState.returnPath || postLoginRedirectPath;
    const multipassLoginUrl = buildMultipassLoginUrl(emailAddress, firstName, lastName, returnPath);

    response.redirect(multipassLoginUrl);
  } catch (error) {
    next(error);
  }
});

application.use((error, request, response, next) => {
  console.error('Google Login Error:', error);
  const statusCode = error.status || 500;
  const isRedirectableError = request.path === '/auth/google/callback';
  isRedirectableError
    ? response.redirect(`${shopifyStoreUrl}/account/login?error=${encodeURIComponent(error.message)}`)
    : response.status(statusCode).json({
        success: false,
        error: error.message,
        details: error.details
      });
});

setInterval(cleanupExpiredAuthorizationStates, 60000);

application.listen(port, () => {
  console.log(`Google Login backend running on port ${port}`);
});

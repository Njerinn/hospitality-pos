process.env.NODE_ENV = 'test';
process.env.PORT = '3000';
process.env.LOG_LEVEL = 'silent';
process.env.DATABASE_URL = 'postgres://localhost/test';
process.env.DATABASE_SSL = 'false';
process.env.JWT_SECRET = 'test_secret_that_is_at_least_32_chars_long_xx';
process.env.COOKIE_SECRET = 'test_cookie_secret_at_least_32_chars_long_x';
process.env.WEB_ORIGIN = 'http://localhost:3000';
process.env.MPESA_CONSUMER_KEY = 'test';
process.env.MPESA_CONSUMER_SECRET = 'test';
process.env.MPESA_PASSKEY = 'test';
process.env.MPESA_TILL_NUMBER = '600000';
process.env.MPESA_CONFIRMATION_URL = 'https://example.com/mpesa/confirmation';
process.env.MPESA_VALIDATION_URL = 'https://example.com/mpesa/validation';
process.env.INTERNAL_HMAC_SECRET = 'test_hmac_secret_at_least_32_chars_long_xx';
process.env.REDIS_URL = '';

// Patch 008B-2: eTIMS test-only tunables (fast timeouts + retries)
process.env.ETIMS_MOCK_ENABLED ??= 'true';
process.env.ETIMS_DEVICE_TIMEOUT_MS ??= '300';
process.env.ETIMS_RETRY_MAX_ATTEMPTS ??= '2';
process.env.ETIMS_RETRY_BACKOFF_MS ??= '50';

/** Jest global setup: deterministic, isolated environment for every suite. */
process.env.NODE_ENV = 'test';
process.env.DB_CLIENT = 'sqlite';
process.env.DATABASE_URL = ':memory:';
process.env.DB_AUTO_MIGRATE = 'false';
process.env.TIMEZONE = 'Asia/Kolkata';
process.env.SESSION_SECRET = 'test-session-secret-that-is-long-enough-123456';
process.env.DASHBOARD_USERNAME = 'admin';
process.env.DASHBOARD_PASSWORD = 'test-password';
process.env.API_KEY = 'test-api-key';
process.env.LOG_TO_CONSOLE = 'false';
process.env.LOG_DIR = './logs';
process.env.AI_ENABLED = 'false';
process.env.AI_PROVIDER = 'none';
process.env.SCHEDULER_ENABLED = 'true';
// Dry-run stays off: suites inject FakeGateway, so nothing reaches WhatsApp.
process.env.WHATSAPP_DRY_RUN = 'false';
process.env.RATE_LIMIT_MIN_GAP_MS = '0';

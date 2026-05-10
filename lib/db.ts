import postgres from 'postgres';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is required');
}

const isLocal = connectionString.includes('localhost') || connectionString.includes('127.0.0.1');

const sql = postgres(connectionString, {
  max: 5,
  ssl: isLocal ? false : { rejectUnauthorized: false },
  idle_timeout: 20,
  max_lifetime: 60 * 30,
  onnotice: () => {},
});

export default sql;

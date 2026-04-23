import postgres from 'postgres';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is required');
}

const sql = postgres(connectionString, {
  max: 1,
  ssl: { rejectUnauthorized: false },
  idle_timeout: 20,
  max_lifetime: 60 * 30,
});

export default sql;

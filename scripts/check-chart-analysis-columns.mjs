import mysql from 'mysql2/promise';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error('DATABASE_URL is missing');
  process.exit(1);
}

const connection = await mysql.createConnection(databaseUrl);

const [rows] = await connection.query(`
  SELECT COLUMN_NAME
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'chartAnalyses'
  ORDER BY ORDINAL_POSITION
`);

console.log(JSON.stringify(rows, null, 2));
await connection.end();

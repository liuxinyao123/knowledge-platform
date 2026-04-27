import mysql from 'mysql2/promise';
export const pool = mysql.createPool({
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DB_PORT ?? 3306),
    database: process.env.DB_NAME ?? 'bookstack',
    user: process.env.DB_USER ?? 'bookstack',
    password: process.env.DB_PASS ?? 'bookstack_secret',
    waitForConnections: true,
    connectionLimit: 5,
});
export async function runMigrations() {
    await pool.execute(`
    CREATE TABLE IF NOT EXISTS knowledge_user_roles (
      user_id     INT          NOT NULL,
      email       VARCHAR(255) NOT NULL,
      name        VARCHAR(255) NOT NULL DEFAULT '',
      role        ENUM('admin','editor','viewer') NOT NULL DEFAULT 'viewer',
      updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id)
    )
  `);
    await pool.execute(`
    CREATE TABLE IF NOT EXISTS knowledge_shelf_visibility (
      shelf_id    INT          NOT NULL,
      shelf_name  VARCHAR(255) NOT NULL DEFAULT '',
      visibility  ENUM('public','team','private') NOT NULL DEFAULT 'public',
      updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (shelf_id)
    )
  `);
}

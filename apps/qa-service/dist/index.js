import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { qaRouter } from './routes/qa.ts';
import { governanceRouter } from './routes/governance.ts';
import { runMigrations } from './services/db.ts';
dotenv.config();
const app = express();
app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json());
app.use('/api/qa', qaRouter);
app.use('/api/governance', governanceRouter);
app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));
const PORT = process.env.PORT ?? 3001;
(async () => {
    await runMigrations();
    app.listen(PORT, () => {
        // eslint-disable-next-line no-console
        console.log(`✓ QA service running → http://localhost:${PORT}`);
    });
})();

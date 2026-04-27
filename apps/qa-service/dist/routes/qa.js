import { Router } from 'express';
import { runRagPipeline } from '../services/ragPipeline.ts';
export const qaRouter = Router();
qaRouter.post('/ask', async (req, res) => {
    const { question } = req.body;
    if (!question?.trim()) {
        return res.status(400).json({ error: 'question is required' });
    }
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.flushHeaders();
    const ac = new AbortController();
    req.on('close', () => ac.abort());
    const emit = (event) => {
        if (!res.writableEnded) {
            res.write(`data: ${JSON.stringify(event)}\n\n`);
        }
    };
    try {
        await runRagPipeline(question, emit, ac.signal);
    }
    catch (err) {
        if (!ac.signal.aborted && !res.writableEnded) {
            emit({ type: 'error', message: err instanceof Error ? err.message : 'Internal error' });
        }
    }
    if (!res.writableEnded)
        res.end();
});

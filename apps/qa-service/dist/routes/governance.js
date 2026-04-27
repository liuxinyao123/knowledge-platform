import { Router } from 'express';
import axios from 'axios';
import { pool } from '../services/db.ts';
const VALID_ROLES = ['admin', 'editor', 'viewer'];
const VALID_VISIBILITIES = ['public', 'team', 'private'];
const ROLE_MAP = { admin: 1, editor: 2, viewer: 3 };
const bs = axios.create({
    baseURL: `${process.env.BOOKSTACK_URL}/api`,
    headers: {
        Authorization: `Token ${process.env.BOOKSTACK_TOKEN_ID}:${process.env.BOOKSTACK_TOKEN_SECRET}`,
    },
});
export const governanceRouter = Router();
governanceRouter.get('/users', async (_req, res) => {
    const [bsResp, [dbRows]] = await Promise.all([
        bs.get('/users', { params: { count: 50 } }),
        pool.execute('SELECT user_id, role FROM knowledge_user_roles'),
    ]);
    const bsUsers = bsResp.data?.data ?? [];
    const roleMap = new Map(dbRows.map((r) => [r.user_id, r.role]));
    const users = bsUsers.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        avatar_url: u.avatar_url ?? null,
        role: roleMap.get(u.id) ?? 'viewer',
    }));
    res.json({ users });
});
governanceRouter.put('/users/:id/role', async (req, res) => {
    const userId = Number(req.params.id);
    const { role } = req.body;
    if (!VALID_ROLES.includes(role)) {
        res.status(400).json({ error: 'invalid role' });
        return;
    }
    await pool.execute(`INSERT INTO knowledge_user_roles (user_id, email, name, role)
     VALUES (?, '', '', ?)
     ON DUPLICATE KEY UPDATE role = VALUES(role)`, [userId, role]);
    await bs.put(`/users/${userId}`, { roles: [ROLE_MAP[role]] });
    res.json({ ok: true });
});
governanceRouter.get('/shelf-visibility', async (_req, res) => {
    const [bsResp, [dbRows]] = await Promise.all([
        bs.get('/shelves', { params: { count: 100 } }),
        pool.execute('SELECT shelf_id, visibility FROM knowledge_shelf_visibility'),
    ]);
    const bsShelves = bsResp.data?.data ?? [];
    const visMap = new Map(dbRows.map((r) => [r.shelf_id, r.visibility]));
    const shelves = bsShelves.map((s) => ({
        id: s.id,
        name: s.name,
        visibility: visMap.get(s.id) ?? 'public',
    }));
    res.json({ shelves });
});
governanceRouter.put('/shelf-visibility/:id', async (req, res) => {
    const shelfId = Number(req.params.id);
    const { visibility } = req.body;
    if (!VALID_VISIBILITIES.includes(visibility)) {
        res.status(400).json({ error: 'invalid visibility' });
        return;
    }
    await pool.execute(`INSERT INTO knowledge_shelf_visibility (shelf_id, shelf_name, visibility)
     VALUES (?, '', ?)
     ON DUPLICATE KEY UPDATE visibility = VALUES(visibility)`, [shelfId, visibility]);
    res.json({ ok: true });
});

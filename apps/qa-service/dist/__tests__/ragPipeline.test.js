import { describe, it, expect, vi, beforeEach } from 'vitest';
// Mock Anthropic SDK
vi.mock('@anthropic-ai/sdk', () => {
    const mockCreate = vi.fn();
    return {
        default: vi.fn().mockImplementation(() => ({
            messages: { create: mockCreate, stream: vi.fn() },
        })),
        _mockCreate: mockCreate,
    };
});
// Mock bookstack service
vi.mock('../services/bookstack.ts', () => ({
    searchPages: vi.fn(),
    getPageContent: vi.fn(),
    stripHtml: (html) => html.replace(/<[^>]+>/g, ''),
}));
function makeDocs(n) {
    return Array.from({ length: n }, (_, i) => ({
        id: i + 1,
        name: `Doc ${i + 1}`,
        url: `http://localhost/pages/${i + 1}`,
        text: `Content of doc ${i + 1}`,
        excerpt: `Excerpt ${i + 1}`,
    }));
}
const noopEmit = () => { };
describe('gradeDocs — fallback top2', () => {
    beforeEach(() => vi.clearAllMocks());
    it('returns top-2 docs when all grade as irrelevant', async () => {
        const { _mockCreate } = await import('@anthropic-ai/sdk');
        _mockCreate.mockResolvedValue({
            content: [{
                    type: 'tool_use',
                    name: 'grade_document',
                    input: { relevant: false, reason: 'not related' },
                }],
        });
        const { gradeDocs } = await import('../services/ragPipeline.ts');
        const docs = makeDocs(8);
        const result = await gradeDocs('test question', docs, noopEmit);
        expect(result.gradedDocs).toHaveLength(2);
        expect(result.gradedDocs[0].id).toBe(1);
        expect(result.gradedDocs[1].id).toBe(2);
        expect(result.rewriteNeeded).toBe(true);
    });
});
describe('gradeDocs — rewriteNeeded threshold', () => {
    beforeEach(() => vi.clearAllMocks());
    it('rewriteNeeded=false when 4 docs pass grading', async () => {
        const { _mockCreate } = await import('@anthropic-ai/sdk');
        let callCount = 0;
        _mockCreate.mockImplementation(async () => {
            callCount++;
            const relevant = callCount <= 4;
            return {
                content: [{
                        type: 'tool_use',
                        name: 'grade_document',
                        input: { relevant, reason: 'test' },
                    }],
            };
        });
        const { gradeDocs } = await import('../services/ragPipeline.ts');
        const docs = makeDocs(6);
        const result = await gradeDocs('test question', docs, noopEmit);
        expect(result.gradedDocs.length).toBeGreaterThanOrEqual(3);
        expect(result.rewriteNeeded).toBe(false);
    });
    it('rewriteNeeded=true when only 2 docs pass grading', async () => {
        const { _mockCreate } = await import('@anthropic-ai/sdk');
        let callCount = 0;
        _mockCreate.mockImplementation(async () => {
            callCount++;
            const relevant = callCount <= 2;
            return {
                content: [{
                        type: 'tool_use',
                        name: 'grade_document',
                        input: { relevant, reason: 'test' },
                    }],
            };
        });
        const { gradeDocs } = await import('../services/ragPipeline.ts');
        const docs = makeDocs(6);
        const result = await gradeDocs('test question', docs, noopEmit);
        expect(result.gradedDocs).toHaveLength(2);
        expect(result.rewriteNeeded).toBe(true);
    });
});
describe('runRagPipeline — abort stops content', () => {
    beforeEach(() => vi.clearAllMocks());
    it('emits no content events after signal is aborted', async () => {
        const { searchPages, getPageContent } = await import('../services/bookstack.ts');
        searchPages.mockResolvedValue([{ id: 1, type: 'page' }]);
        getPageContent.mockResolvedValue({
            id: 1, name: 'Test', url: 'http://test', html: '<p>test</p>',
            text: 'test', excerpt: 'test',
        });
        const { _mockCreate } = await import('@anthropic-ai/sdk');
        // Grade returns relevant
        _mockCreate.mockResolvedValue({
            content: [{ type: 'tool_use', name: 'grade_document', input: { relevant: true } }],
        });
        const ac = new AbortController();
        ac.abort(); // abort immediately
        const { runRagPipeline } = await import('../services/ragPipeline.ts');
        const events = [];
        await runRagPipeline('test', (e) => events.push(e.type), ac.signal);
        expect(events).not.toContain('content');
        expect(events).not.toContain('done');
    });
});

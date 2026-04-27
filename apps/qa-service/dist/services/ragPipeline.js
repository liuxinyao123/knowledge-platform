import Anthropic from '@anthropic-ai/sdk';
import { searchPages, getPageContent } from './bookstack.ts';
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const GRADE_TOOL = {
    name: 'grade_document',
    description: 'Grade document relevance to the user question',
    input_schema: {
        type: 'object',
        properties: {
            relevant: { type: 'boolean', description: 'Is the document relevant?' },
            reason: { type: 'string', description: 'Brief reason' },
        },
        required: ['relevant', 'reason'],
    },
};
const REWRITE_TOOL = {
    name: 'rewrite_query',
    description: 'Choose a query rewrite strategy',
    input_schema: {
        type: 'object',
        properties: {
            strategy: {
                type: 'string',
                enum: ['step_back', 'hyde'],
                description: 'step_back: generalize; hyde: hypothetical answer as query',
            },
            rewritten_query: { type: 'string', description: 'The rewritten query' },
        },
        required: ['strategy', 'rewritten_query'],
    },
};
async function retrieveInitial(question, emit) {
    emit({ type: 'rag_step', icon: '🔍', label: '正在检索知识库...' });
    const pages = await searchPages(question, 15);
    const docs = await Promise.all(pages.map((p) => getPageContent(p.id)));
    return docs;
}
export async function gradeDocs(question, docs, emit) {
    emit({ type: 'rag_step', icon: '📊', label: '正在评估文档相关性...' });
    const results = await Promise.all(docs.map(async (doc) => {
        const res = await anthropic.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 150,
            tools: [GRADE_TOOL],
            tool_choice: { type: 'tool', name: 'grade_document' },
            messages: [{
                    role: 'user',
                    content: `Question: ${question}\n\nDocument: ${doc.text.slice(0, 500)}`,
                }],
        });
        const toolUse = res.content.find((c) => c.type === 'tool_use');
        const input = toolUse?.input ?? {};
        return { doc, relevant: Boolean(input.relevant) };
    }));
    const relevant = results.filter((r) => r.relevant).map((r) => r.doc);
    const gradedDocs = relevant.length >= 2 ? relevant : docs.slice(0, 2);
    return { gradedDocs, rewriteNeeded: gradedDocs.length < 3 };
}
async function rewriteQuestion(question, emit) {
    emit({ type: 'rag_step', icon: '✏️', label: '正在重写查询...' });
    const res = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 400,
        tools: [REWRITE_TOOL],
        tool_choice: { type: 'tool', name: 'rewrite_query' },
        messages: [{
                role: 'user',
                content: `选择最合适的查询扩展策略并重写查询：\nstep_back: 泛化具体问题为更宽泛的概念\nhyde: 生成一个假设答案作为新查询\n\n原始问题: ${question}`,
            }],
    });
    const toolUse = res.content.find((c) => c.type === 'tool_use');
    const input = toolUse?.input ?? {};
    return {
        strategy: (input.strategy === 'hyde' ? 'hyde' : 'step_back'),
        rewrittenQuery: input.rewritten_query ?? question,
    };
}
async function retrieveExpanded(rewrittenQuery, initialDocs, emit) {
    emit({ type: 'rag_step', icon: '🔄', label: '使用扩展查询重新检索...' });
    const newPages = await searchPages(rewrittenQuery, 15);
    const newDocs = await Promise.all(newPages.map((p) => getPageContent(p.id)));
    const seen = new Set(initialDocs.map((d) => d.id));
    return [...initialDocs, ...newDocs.filter((d) => !seen.has(d.id))];
}
async function generateAnswer(question, docs, emit, signal) {
    emit({ type: 'rag_step', icon: '💡', label: '正在生成回答...' });
    const context = docs.map((d, i) => `[${i + 1}] ${d.name}\n${d.text}`).join('\n\n---\n\n');
    const stream = anthropic.messages.stream({
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        system: `你是知识库助手。根据以下文档内容回答用户问题。\n用[1][2]等标注引用来源，只使用提供的文档，不编造信息。\n\n文档内容：\n${context}`,
        messages: [{ role: 'user', content: question }],
    });
    for await (const chunk of stream) {
        if (signal.aborted) {
            stream.abort();
            break;
        }
        if (chunk.type === 'content_block_delta' &&
            chunk.delta.type === 'text_delta') {
            emit({ type: 'content', text: chunk.delta.text });
        }
    }
}
function toCitation(doc, index) {
    return {
        index,
        page_id: doc.id,
        page_name: doc.name,
        page_url: doc.url,
        excerpt: doc.excerpt,
    };
}
export async function runRagPipeline(question, emit, signal) {
    const trace = {
        initial_results: [],
        grade_result: { kept: 0, total: 0 },
        rewrite_triggered: false,
        final_results: [],
    };
    if (signal.aborted)
        return;
    const initialDocs = await retrieveInitial(question, emit);
    trace.initial_results = initialDocs.map((d, i) => toCitation(d, i + 1));
    if (signal.aborted)
        return;
    const { gradedDocs, rewriteNeeded } = await gradeDocs(question, initialDocs, emit);
    trace.grade_result = { kept: gradedDocs.length, total: initialDocs.length };
    let finalDocs = gradedDocs;
    if (rewriteNeeded && !signal.aborted) {
        const { strategy, rewrittenQuery } = await rewriteQuestion(question, emit);
        trace.rewrite_triggered = true;
        trace.rewrite_strategy = strategy;
        trace.rewritten_query = rewrittenQuery;
        if (!signal.aborted) {
            finalDocs = await retrieveExpanded(rewrittenQuery, gradedDocs, emit);
        }
    }
    trace.final_results = finalDocs.map((d, i) => toCitation(d, i + 1));
    if (!signal.aborted) {
        await generateAnswer(question, finalDocs, emit, signal);
        emit({ type: 'trace', data: trace });
        emit({ type: 'done' });
    }
}

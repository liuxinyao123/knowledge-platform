import axios from 'axios';
const bs = axios.create({
    baseURL: `${process.env.BOOKSTACK_URL}/api`,
    headers: {
        Authorization: `Token ${process.env.BOOKSTACK_TOKEN_ID}:${process.env.BOOKSTACK_TOKEN_SECRET}`,
    },
});
export function stripHtml(html) {
    return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}
export async function searchPages(query, count = 15) {
    const res = await bs.get('/search', { params: { query, count } });
    return (res.data?.data ?? []).filter((r) => r.type === 'page').slice(0, 8);
}
export async function getPageContent(id) {
    const res = await bs.get(`/pages/${id}`);
    const page = res.data;
    const text = stripHtml(page.html).slice(0, 2000);
    return {
        ...page,
        text,
        excerpt: text.slice(0, 200),
    };
}

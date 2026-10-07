/**
 * Blog index: one ordering for every surface that lists posts (the blog
 * index, the search index, the sitemap). Newest first; posts of the same day
 * fall back to their ID, so the order never depends on file-system order.
 */
import { getCollection, type CollectionEntry } from 'astro:content';

export type Post = CollectionEntry<'blog'>;

export async function allPosts(): Promise<Post[]> {
  const posts = await getCollection('blog');
  return posts.sort((a, b) => b.data.date.getTime() - a.data.date.getTime() || a.id.localeCompare(b.id));
}

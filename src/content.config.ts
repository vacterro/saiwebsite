/**
 * Content collections (MASTER_ROADMAP M5, M17, M24).
 *
 * The schema IS the front-matter validator: a missing field, an unknown
 * section or maturity, or an over-long description fails `astro build` with
 * the file name, before anything is published.
 *
 * Authority (MASTER_ROADMAP §4) is declared per page:
 *   reference    machine-checkable protocol facts, generated or quoted
 *   engineering  how the protocol works and how to use it
 *   explanation  the human "why"
 * Every docs page names at least one canonical SAIPEN source it rests on.
 */
import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

export const DOC_SECTIONS = [
  'getting-started',
  'concepts',
  'protocol',
  'recovery',
  'evidence',
  'operation',
  'reference',
] as const;

const docs = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/docs' }),
  schema: z.object({
    title: z.string().min(2).max(60),
    description: z.string().min(20).max(200),
    section: z.enum(DOC_SECTIONS),
    order: z.number().int().min(1),
    maturity: z.enum(['draft', 'preview', 'stable']),
    authority: z.enum(['reference', 'engineering', 'explanation']),
    sources: z
      .array(
        z.object({
          path: z.string(),
          anchor: z.string().optional(),
          label: z.string(),
        }),
      )
      .min(1),
  }),
});

const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({
    title: z.string().max(80),
    description: z.string().min(20).max(200),
    date: z.coerce.date(),
    kind: z.enum(['design-note', 'research', 'tutorial']),
  }),
});

const changelog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/changelog' }),
  schema: z.object({
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    date: z.coerce.date(),
    title: z.string().max(80),
    scope: z.enum(['site']),
  }),
});

export const collections = { docs, blog, changelog };

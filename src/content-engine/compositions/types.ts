export type SectionPolicy = {
  id: string;
  owner: string;
  order: number;
  visibility: 'public' | 'hidden';
  maturity: 'placeholder' | 'draft' | 'experimental' | 'preview' | 'stable' | 'deprecated';
  sourceIds: string[];
  localizable: boolean;
  validation: { gates: string[]; required?: boolean };
};
export type CompositionSection = SectionPolicy & (
  | { type: 'heading' | 'paragraph'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'cards'; cards: { title: string; body: string[]; action?: { label: string; href: string } }[] }
  | { type: 'slot'; slot: string; blocks: string[] }
);
export type PageComposition = {
  schemaVersion: 2;
  page: string;
  mode: 'page' | 'append' | 'slots';
  availableSlots?: string[];
  metadataBlocks?: string[];
  title?: string;
  description?: string;
  bindings: Record<string, string>;
  sections: CompositionSection[];
};

/** Small, transactional authoring operations over the existing registries and catalogues. */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { validateCatalog } from '../blocks/blocks.mjs';
import { compositionBlocks, orderedSections, validateComposition } from '../compositions/compositions.mjs';
import { ID_PATTERN, validateRegistry } from '../registry/schema.mjs';
import { loadStore, unitReport } from '../i18n/store.mjs';
import { serialize } from '../sources/lock.mjs';
import { withinRoot, withMutationLock, writeTransaction } from './files.mjs';
import { referenceSources } from '../sources/references.mjs';

const REGISTRY = 'src/content-engine/registry/pages.json';
const SOURCES = 'src/content-engine/registry/sources.json';
const COMPOSITIONS = 'src/content-engine/compositions';
const BLOCKS = 'src/content-engine/blocks';
const json = (root, file) => JSON.parse(readFileSync(withinRoot(root, file), 'utf8'));
const fail = (message) => { throw new Error(`[content-operation] ${message}`); };

function argumentsOf(args) {
  const values = {}, positional = [];
  const boolean = new Set(['dry-run', 'json', 'hidden']);
  const allowed = new Set([...boolean, 'text', 'type', 'file', 'before', 'after', 'route', 'title', 'description', 'label', 'nav', 'maturity', 'source', 'section', 'block', 'replacement']);
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith('--')) { positional.push(args[i]); continue; }
    const key = args[i].slice(2);
    if (!allowed.has(key)) fail(`unknown option --${key}`);
    if (!boolean.has(key) && (!args[i+1] || args[i+1].startsWith('--'))) fail(`--${key} needs a value`);
    if (key === 'source') (values.source ??= []).push(args[++i]);
    else values[key] = boolean.has(key) ? true : args[++i];
  }
  return { values, positional };
}

export function planContentOperation(args, root = '.') {
  const { values: options, positional } = argumentsOf(args);
  const [subject, action, id, second] = positional;
  const registry = json(root, REGISTRY);
  const sourceIds = json(root, SOURCES).sources.map((s) => s.id);
  const catalogs = Object.fromEntries(readdirSync(join(root, BLOCKS)).filter((f) => f.endsWith('.json')).map((f) => [`${BLOCKS}/${f}`, json(root, `${BLOCKS}/${f}`)]));
  const compositions = Object.fromEntries(readdirSync(join(root, COMPOSITIONS)).filter((f) => f.endsWith('.json')).map((f) => [`${COMPOSITIONS}/${f}`, json(root, `${COMPOSITIONS}/${f}`)]));
  const originals = new Map([[REGISTRY, serialize(registry)], ...Object.entries(catalogs).map(([p,d]) => [p,serialize(d)]), ...Object.entries(compositions).map(([p,d]) => [p,serialize(d)])]);
  const before = loadStore({ root, registry, sourceIds });
  const beforeRows = unitReport(before);
  const page = () => registry.pages.find((p) => p.id === id) ?? fail(`unknown page ${id}`);
  const catalogOf = (blockId, create = false) => {
    if (!/^[a-z0-9-]+\.[a-z0-9.-]+$/.test(blockId ?? '')) fail('block IDs are stable dotted lowercase names');
    const domain = blockId.split('.')[0];
    if (['pages', 'pages-internal'].includes(domain)) fail('navigation labels belong to pages.json; use page nav --label');
    const path = `${BLOCKS}/${domain}.json`;
    if (create && !catalogs[path]) catalogs[path] = { schemaVersion: 1, domain, usedBy: [], blocks: {} };
    return { path, doc: catalogs[path] ?? fail(`unknown block domain ${domain}`) };
  };
  const compositionOf = (create = false) => {
    const owner = page();
    let entry = Object.entries(compositions).find(([,d]) => d.page === id);
    if (!entry && create) {
      const path = `${COMPOSITIONS}/${id}.json`;
      compositions[path] = { schemaVersion: 2, page: id, mode: 'append', bindings: {}, sections: [] };
      entry = [path, compositions[path]];
    }
    if (!entry) fail(`page ${id} has no composition; section add creates an append manifest`);
    if (entry[1].schemaVersion !== 2) fail('migrate the existing composition to schemaVersion 2 before editing sections');
    return { path: entry[0], doc: entry[1], owner };
  };
  if (!id || !ID_PATTERN.test(id)) fail('a stable ID is required');
  if (subject === 'block') {
    const { doc } = catalogOf(id, action === 'add');
    const block = doc.blocks[id];
    if (action === 'add' || action === 'edit') {
      if (typeof options.text !== 'string') fail('--text is required');
      if (action === 'edit' && !block) fail(`unknown block ${id}`);
      const next = { ...(block ?? {}), type: options.type ?? block?.type ?? 'text', text: options.text, ...(options.source ? { sourceIds: [...new Set(options.source)].sort() } : {}) };
      if (action === 'add' && block && serialize(block) !== serialize(next)) fail(`${id} already exists with different content; use block edit`);
      doc.blocks[id] = next;
    } else if (action === 'remove') {
      const refs = Object.entries(compositions).filter(([,d]) => compositionBlocks(d).includes(id)).map(([p]) => p);
      const scan = (folder) => {
        for (const e of readdirSync(folder, { withFileTypes: true })) {
          const file = join(folder,e.name);
          if (e.isDirectory()) scan(file);
          else if (/\.(astro|ts)$/.test(file) && readFileSync(file,'utf8').includes(`'${id}'`)) refs.push(file);
          else if (/\.(astro|ts)$/.test(file) && readFileSync(file,'utf8').includes(`"${id}"`)) refs.push(file);
        }
      };
      for (const folder of ['src/views','src/components','src/pages','src/layouts']) if (existsSync(join(root,folder))) scan(join(root,folder));
      if (refs.length) fail(`${id} is still referenced by ${refs.join(', ')}; remove references first`);
      delete doc.blocks[id]; // Translation files are intentionally retained as ORPHANED.
    } else fail('block actions: add, edit, remove');
  } else if (subject === 'section') {
    if (!second || !ID_PATTERN.test(second)) fail('section operations require <page-id> <section-id>');
    const { doc, owner } = compositionOf(action === 'add');
    const existing = doc.sections.find((s) => s.id === second);
    if (action === 'add') {
      if (!options.file) fail('section add needs --file <section.json> (heading, paragraph, list or cards)');
      const input = JSON.parse(readFileSync(options.file, 'utf8'));
      const section = { ...input, id: second, owner: id, order: existing?.order ?? Math.max(0,...doc.sections.map((s) => s.order))+10, visibility: options.hidden ? 'hidden' : input.visibility ?? 'public', maturity: input.maturity ?? owner.maturity, sourceIds: input.sourceIds ?? [], localizable: input.localizable ?? owner.localizable, validation: input.validation ?? { gates: ['validate:content','validate:registry'] } };
      if (existing && serialize(existing) !== serialize(section)) fail(`section ${second} already exists with different content`);
      if (!existing) doc.sections.push(section);
    } else if (action === 'remove') {
      if (existing?.validation?.required) fail(`${second} is required; deactivate or remove a different section`);
      doc.sections = doc.sections.filter((s) => s.id !== second);
    }
    else if (action === 'move') {
      if (!existing || Boolean(options.before) === Boolean(options.after)) fail('section move needs an existing ID and exactly one of --before or --after');
      const target = options.before ?? options.after;
      if (target !== second) {
        const list = orderedSections(doc).filter((s) => s.id !== second);
        const at = list.findIndex((s) => s.id === target);
        if (at < 0) fail(`unknown target section ${target}`);
        list.splice(at+(options.after?1:0),0,existing);
        list.forEach((s,i) => { s.order=(i+1)*10; });
        doc.sections=list;
      }
    } else if (action === 'show' || action === 'hide') {
      if (!existing) fail(`unknown section ${second}`);
      if (action==='hide' && existing.validation?.required) fail(`${second} is required`);
      existing.visibility=action==='show'?'public':'hidden';
    } else fail('section actions: add, move, remove, show, hide');
  } else if (subject === 'page') {
    if (action === 'create') {
      if (!options.route || !options.title || !options.description) fail('page create needs --route, --title and --description');
      const existing = registry.pages.find((p) => p.id === id);
      if (existing) {
        if (existing.route !== options.route || existing.label !== (options.label ?? options.title) || !existing.composition) fail(`page ${id} already exists with different metadata`);
        const comp=Object.values(compositions).find((d)=>d.page===id),domain=id.replaceAll('.','-'),cat=catalogs[`${BLOCKS}/${domain}.json`];
        if(cat?.blocks[comp?.title]?.text!==options.title||cat?.blocks[comp?.description]?.text!==options.description)fail(`page ${id} already exists with different text; edit its stable blocks`);
      } else {
        const domain=id.replaceAll('.','-');
        const path=`${BLOCKS}/${domain}.json`;
        if (catalogs[path] || compositions[`${COMPOSITIONS}/${id}.json`]) fail(`existing files already own ${id}`);
        registry.pages.push({ id, route: options.route, label: options.label ?? options.title, intent: options.description, kind:'article', owner:'editorial', maturity:options.maturity ?? 'draft', audience:'public', nav:options.nav ?? 'none', localizable:true, searchable:true, llmVisible:true, sourceIds:options.source ?? [], composition:id });
        catalogs[path]={schemaVersion:1,domain,usedBy:[`page:${id}`],blocks:{[`${domain}.title`]:{type:'text',text:options.title},[`${domain}.description`]:{type:'text',text:options.description}}};
        compositions[`${COMPOSITIONS}/${id}.json`]={schemaVersion:2,page:id,mode:'page',title:`${domain}.title`,description:`${domain}.description`,bindings:{},sections:[]};
      }
    } else if (action === 'move') {
      const owner=page();
      if (!owner.composition || !options.route) fail('page move supports data-driven pages and needs --route');
      if (owner.route !== options.route) {
        const old=owner.route;
        owner.route=options.route;
        const aliasId=`alias.${id}.${createHash('sha256').update(old).digest('hex').slice(0,8)}`;
        registry.pages.push({id:aliasId,route:old,label:owner.label,intent:`Moved to ${owner.route}; stable content identity ${id}.`,kind:'alias',owner:'generated',maturity:'stable',audience:'public',nav:'none',localizable:false,searchable:false,llmVisible:false,sourceIds:[],redirectTo:id});
      }
    } else if (action === 'nav') {
      const owner=page();
      if (!options.nav) fail('page nav needs --nav primary|secondary|none');
      owner.nav=options.nav;
      if (options.label) owner.label=options.label;
    } else if (action === 'deprecate') {
      const owner=page(); owner.maturity='deprecated'; owner.nav='none';
    } else if (action === 'remove') {
      const owner=page(), replacement=registry.pages.find((p) => p.id === options.replacement);
      if (!owner.composition || !replacement || replacement.id===id || replacement.kind==='alias') fail('page remove needs a data-driven page and --replacement <another-page-id> to preserve incoming links');
      delete owner.composition;
      Object.assign(owner,{kind:'alias',owner:'generated',maturity:'deprecated',nav:'none',localizable:false,searchable:false,llmVisible:false,redirectTo:replacement.id});
      for (const [path,doc] of Object.entries(compositions)) if (doc.page===id) delete compositions[path];
      for (const p of registry.pages) if (p.redirectTo===id) p.redirectTo=replacement.id;
      // Canonical blocks and all translations survive; explicit cleanup owns them.
    } else fail('page actions: create, move, nav, deprecate, remove');
  } else if (subject === 'dependency') {
    if (!sourceIds.includes(second)) fail(`unknown source ${second}`);
    let target=page();
    if (options.section) target=compositionOf().doc.sections.find((s) => s.id===options.section) ?? fail(`unknown section ${options.section}`);
    if (options.block) target=catalogOf(options.block).doc.blocks[options.block] ?? fail(`unknown block ${options.block}`);
    const set=new Set(target.sourceIds ?? []);
    if (action==='add') set.add(second); else if (action==='remove') set.delete(second); else fail('dependency actions: add, remove');
    target.sourceIds=[...set].sort();
  } else fail('usage: site:content block|section|page|dependency <action> <stable-id> [options] [--dry-run] [--json]');

  const problems=validateRegistry(registry,sourceIds,{derivedSourceIds:referenceSources(root).filter((r)=>r.pages.length).map((r)=>r.id)});
  const gates=new Set(json(root,'src/content-engine/registry/tests.json').gates.map((g)=>g.id));
  for (const [file,doc] of Object.entries(catalogs)) problems.push(...validateCatalog(doc,file,sourceIds));
  const after=loadStore({root,registry,sourceIds,overrides:{catalogDocs:Object.entries(catalogs).map(([file,doc])=>({file,doc})),compositions:Object.values(compositions)}});
  problems.push(...after.problems);
  for (const [file,doc] of Object.entries(compositions)) {
    problems.push(...validateComposition(doc,file,after.blocks,registry.pages.map((p)=>p.id),sourceIds));
    for(const section of doc.sections ?? []) for(const gate of section.validation?.gates ?? []) if(!gates.has(gate)) problems.push(`[unknown-gate] ${file} ${section.id}: ${gate}`);
  }
  for (const p of registry.pages.filter((p)=>p.composition)) if (!Object.values(compositions).some((d)=>d.page===p.id && d.mode==='page')) problems.push(`[composition] ${p.id}: missing full-page manifest`);
  if (problems.length) fail(problems.join('\n'));
  const changed={};
  for (const [path,doc] of [[REGISTRY,registry],...Object.entries(catalogs),...Object.entries(compositions)]) if (serialize(doc)!==originals.get(path)) changed[path]=serialize(doc);
  for (const path of originals.keys()) if (path.startsWith(`${COMPOSITIONS}/`) && !(path in compositions)) changed[path]=null;
  const oldStatus=new Map(beforeRows.map((r)=>[`${r.locale}:${r.id}`,r.status]));
  const invalidated=unitReport(after).filter((r)=>['STALE','ORPHANED','MISSING'].includes(r.status) && oldStatus.get(`${r.locale}:${r.id}`)!==r.status).map(({locale,id,status})=>({locale,id,status}));
  return { operation:`${subject} ${action} ${id}${second?` ${second}`:''}`, dryRun:Boolean(options['dry-run']), changedFiles:Object.keys(changed).sort(), invalidated, changes:changed, next:'npm run site:prepare', json:Boolean(options.json) };
}

export function runContentOperation(args, root='.') {
  const dryRun=args.includes('--dry-run');
  const perform=()=>{
    const plan=planContentOperation(args,root);
    if (!dryRun && plan.changedFiles.length) writeTransaction(root,plan.changes);
    return plan;
  };
  return dryRun?perform():withMutationLock(root,perform);
}

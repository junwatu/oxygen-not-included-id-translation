#!/usr/bin/env node
/*
  Translate a POT file to Indonesian PO using Azure OpenAI Responses API.

  Env vars required:
    - AZURE_OPENAI_ENDPOINT (e.g., https://jih-ai-resource.cognitiveservices.azure.com)
    - AZURE_API_KEY
    - AZURE_OPENAI_MODEL (default: gpt-5)
    - AZURE_OPENAI_API_VERSION (default: 2025-04-01-preview)

  Usage:
    node scripts/ai_translate_po.js --pot strings_template.pot --po strings.po [--limit 100] [--sleep 0.1] [--stream] [--flush-every 50] [--resume|--no-resume] [--force]
*/

import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { setTimeout as sleep } from 'timers/promises';
import gettextParser from 'gettext-parser';
import dotenv from 'dotenv';

// Load environment from .env.local if present
try {
  dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
} catch {}

const PLACEHOLDER_PATTERNS = [
  /<[^>]+>/g,         // HTML-like tags e.g., <link="...">, <i>, </i>
  /\{\w+\}/g,        // {name}
  /\{\d+\}/g,        // {0}
  /%\d+\$\w/g,       // %1$s
  /%[sdif]/g,         // %s, %d, etc.
  /\$\{[^}]+\}/g,    // ${var}
];

function extractPlaceholders(text = '') {
  const found = new Set();
  for (const re of PLACEHOLDER_PATTERNS) {
    const m = text.match(re);
    if (m) m.forEach((x) => found.add(x));
  }
  return Array.from(found);
}

function buildUserPrompt(msgid, ctx, placeholders) {
  const lines = [];
  lines.push('Translate the English string into Indonesian.');
  lines.push('Strictly preserve placeholders, tags, punctuation, and line breaks.');
  lines.push('Match the exact number of leading and trailing line breaks as the English.');
  lines.push('Do not add or remove tags or placeholders. Output only the translation.');
  if (ctx) lines.push(`Context: ${ctx}`);
  lines.push(`English: ${msgid}`);
  if (placeholders.length) {
    lines.push(`Placeholders to preserve: ${placeholders.join(', ')}`);
  }
  return lines.join('\n');
}

async function callAzureResponses({ endpoint, apiKey, model, input, maxOutputTokens = 1024, temperature, reasoningEffort }) {
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION || '2025-04-01-preview';
  const url = `${endpoint.replace(/\/$/, '')}/openai/responses?api-version=${apiVersion}`;

  // Build request body and post, with compatibility retries for unsupported params
  const baseBody = { model, input, max_output_tokens: maxOutputTokens };
  if (typeof temperature === 'number' && Number.isFinite(temperature)) {
    baseBody.temperature = temperature;
  }
  if (reasoningEffort) {
    baseBody.reasoning = { effort: reasoningEffort };
  }

  const post = async (bodyObj) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(bodyObj),
    });
    if (!res.ok) {
      const text = await res.text();
      // Try to parse JSON error
      try {
        const errJson = JSON.parse(text);
        const msg = errJson?.error?.message || text;
        const param = errJson?.error?.param || '';
        const unsupported = /Unsupported parameter/i.test(msg);
        if (res.status === 400 && unsupported) {
          const newBody = { ...bodyObj };
          let changed = false;
          if (param.includes('reasoning') || /reasoning\.effort/.test(msg)) {
            if (newBody.reasoning) { delete newBody.reasoning; changed = true; }
          }
          if (param === 'temperature' || /temperature/.test(msg)) {
            if (typeof newBody.temperature !== 'undefined') { delete newBody.temperature; changed = true; }
          }
          if (changed) {
            const retryRes = await fetch(url, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
              },
              body: JSON.stringify(newBody),
            });
            if (!retryRes.ok) {
              const retryText = await retryRes.text();
              throw new Error(`Azure OpenAI error ${retryRes.status}: ${retryText.slice(0, 500)}`);
            }
            return retryRes.json();
          }
        }
      } catch (_) {
        // ignore parse issues and throw below
      }
      throw new Error(`Azure OpenAI error ${res.status}: ${text.slice(0, 500)}`);
    }
    return res.json();
  };

  const data = await post(baseBody);

  // If response was cut off due to token limit, signal to caller for retry
  if (data.status === 'incomplete' && data.incomplete_details?.reason === 'max_output_tokens') {
    const err = new Error('incomplete_max_output_tokens');
    err.code = 'incomplete_max_output_tokens';
    err.payload = data;
    throw err;
  }
  if (data.status === 'incomplete' && data.incomplete_details?.reason === 'max_output_tokens') {
    const err = new Error('incomplete_max_output_tokens');
    err.code = 'incomplete_max_output_tokens';
    err.payload = data;
    throw err;
  }
  // Prefer output_text if available (Responses API convenience field)
  if (typeof data.output_text === 'string' && data.output_text.length > 0) {
    return data.output_text; // do not trim to preserve edge newlines
  }

  const extractFromContentArray = (arr) => {
    if (!Array.isArray(arr)) return '';
    const texts = [];
    for (const part of arr) {
      // Responses API may return {type: 'output_text'|'text', text: '...'}
      if ((part?.type === 'output_text' || part?.type === 'text') && typeof part.text === 'string') {
        texts.push(part.text);
      } else if (typeof part === 'string') {
        texts.push(part);
      }
    }
    return texts.join('\n'); // preserve edge newlines
  };

  // output -> array -> first item content
  if (Array.isArray(data.output)) {
    for (const item of data.output) {
      const maybe = extractFromContentArray(item?.content);
      if (maybe) return maybe;
      const maybeMsg = extractFromContentArray(item?.message?.content);
      if (maybeMsg) return maybeMsg;
    }
  }

  // choices -> message -> content (string or array)
  if (Array.isArray(data.choices) && data.choices[0]?.message) {
    const mc = data.choices[0].message.content;
    if (typeof mc === 'string') return mc; // preserve edge newlines
    const maybeChoices = extractFromContentArray(mc);
    if (maybeChoices) return maybeChoices;
  }

  // message -> content (non-standard but seen in some proxies)
  if (data.message?.content) {
    if (typeof data.message.content === 'string') return data.message.content; // preserve edge newlines
    const maybeMsg = extractFromContentArray(data.message.content);
    if (maybeMsg) return maybeMsg;
  }

  // As a last resort, expose payload snippet for debugging
  console.error('[debug] Unexpected payload:', JSON.stringify(data).slice(0, 1200));
  throw new Error('Unexpected Azure Responses payload shape');
}

function parseArgs(argv) {
  const args = { limit: 0, sleep: 0, stream: false, flushEvery: 0, resume: true, force: false, onlyUntranslated: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--pot') args.pot = argv[++i];
    else if (a === '--po') args.po = argv[++i];
    else if (a === '--limit') args.limit = parseInt(argv[++i], 10) || 0;
    else if (a === '--sleep') args.sleep = parseFloat(argv[++i]) || 0;
    else if (a === '--stream') args.stream = true;
    else if (a === '--flush-every') args.flushEvery = parseInt(argv[++i], 10) || 0;
    else if (a === '--resume') args.resume = true;
    else if (a === '--no-resume') args.resume = false;
    else if (a === '--force') { args.force = true; args.resume = false; }
    else if (a === '--only-untranslated') args.onlyUntranslated = true;
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

function usage() {
  console.log('Usage: node scripts/ai_translate_po.js --pot strings_template.pot --po strings.po [--limit N] [--sleep S] [--stream] [--flush-every N] [--resume|--no-resume] [--force] [--only-untranslated]');
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.pot || !args.po) {
    usage();
    process.exit(args.help ? 0 : 1);
  }

  // Helpers to enforce matching leading/trailing newlines between msgid and translation
  const countLeadingNewlines = (s = '') => {
    let i = 0; while (i < s.length && s[i] === '\n') i += 1; return i;
  };
  const countTrailingNewlines = (s = '') => {
    let i = 0; while (i < s.length && s[s.length - 1 - i] === '\n') i += 1; return i;
  };
  const adjustEdgeNewlines = (s = '', ref = '') => {
    const leadRef = countLeadingNewlines(ref);
    const trailRef = countTrailingNewlines(ref);
    const core = s.replace(/^\n+/, '').replace(/\n+$/, '');
    return ('\n'.repeat(leadRef)) + core + ('\n'.repeat(trailRef));
  };

  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const apiKey = process.env.AZURE_API_KEY;
  const model = process.env.AZURE_OPENAI_MODEL || 'gpt-5';
  const fallbackModel = process.env.AZURE_FALLBACK_MODEL || 'gpt-4.1';
  if (!endpoint || !apiKey) {
    console.error('Missing AZURE_OPENAI_ENDPOINT or AZURE_API_KEY');
    process.exit(1);
  }

  const potBuf = await fsp.readFile(args.pot);
  const pot = gettextParser.po.parse(potBuf);

  // Try to load existing PO to resume
  let existingPo = null;
  if (args.resume) {
    try {
      if (fs.existsSync(args.po)) {
        const poBuf = await fsp.readFile(args.po);
        existingPo = gettextParser.po.parse(poBuf);
        console.log(`Resuming from existing ${args.po}`);
      }
    } catch (e) {
      console.warn(`[warn] Failed to load existing PO (${args.po}): ${e.message}`);
      existingPo = null;
    }
  }

  const out = existingPo && existingPo.translations
    ? existingPo
    : { charset: 'utf-8', translations: {} };
  // Ensure/refresh headers
  out.headers = {
    ...(out.headers || {}),
    'Project-Id-Version': pot.headers?.['Project-Id-Version'] || out.headers?.['Project-Id-Version'] || '',
    'POT-Creation-Date': pot.headers?.['POT-Creation-Date'] || out.headers?.['POT-Creation-Date'] || '',
    'PO-Revision-Date': out.headers?.['PO-Revision-Date'] || '',
    'Last-Translator': out.headers?.['Last-Translator'] || '',
    'Language-Team': out.headers?.['Language-Team'] || '',
    'Language': 'id',
    'MIME-Version': '1.0',
    'Content-Type': 'text/plain; charset=UTF-8',
    'Content-Transfer-Encoding': '8bit',
    'Plural-Forms': 'nplurals=1; plural=0;',
    'Application': 'Oxygen Not Included',
    'X-Generator': 'ai_translate_po.js',
  };

  // Simple translation memory to reuse identical English across contexts within and across runs
  const tm = new Map();
  for (const [ctx, ctxBlock] of Object.entries(out.translations || {})) {
    for (const [msgid, item] of Object.entries(ctxBlock || {})) {
      if (ctx === '' && msgid === '') continue;
      const candidate = Array.isArray(item?.msgstr) ? (item.msgstr[0] || '') : '';
      const isFuzzy = !!(item?.flags && item.flags.fuzzy);
      if (!isFuzzy && candidate && !tm.has(msgid)) {
        tm.set(msgid, candidate);
      }
    }
  }

  const entries = [];
  for (const [ctx, ctxBlock] of Object.entries(pot.translations || {})) {
    for (const [msgid, item] of Object.entries(ctxBlock || {})) {
      // Skip the header entry
      if (ctx === '' && msgid === '') continue;
      entries.push({ ctx, item });
    }
  }

  let processed = 0;
  const shouldFlush = () => args.stream || (args.flushEvery > 0 && processed > 0 && processed % args.flushEvery === 0);
  const atomicWrite = async (filePath, buf) => {
    const tmp = `${filePath}.partial`;
    await fsp.writeFile(tmp, buf);
    await fsp.rename(tmp, filePath);
  };
  for (const { ctx, item } of entries) {
    const msgid = item.msgid || '';
    const msgidPlural = item.msgid_plural || null;
    const placeholders = extractPlaceholders(msgid);
    const userContent = buildUserPrompt(msgid, ctx || '', placeholders);
    let translation = '';

    // Skip if resuming and existing translation is good
    const prev = out.translations?.[ctx]?.[msgid];
    const prevStr = Array.isArray(prev?.msgstr) ? (prev.msgstr[0] || '') : '';
    const prevFuzzy = !!(prev?.flags && prev.flags.fuzzy);
    const prevMissing = placeholders.filter((ph) => !prevStr.includes(ph));
    const canSkip = !args.force && prev && (
      args.onlyUntranslated ? (prevStr.trim().length > 0) : (!prevFuzzy && prevStr.trim().length > 0 && prevMissing.length === 0)
    );
    if (canSkip) {
      // Ensure structure exists in out (resume keeps it), normalize edge newlines, then maybe flush
      const normalizePrev = (p) => {
        try {
          if (Array.isArray(p?.msgstr) && p.msgstr.length > 0) {
            // Adjust msgstr[0] newlines to match msgid
            p.msgstr[0] = adjustEdgeNewlines(String(p.msgstr[0] || ''), msgid);
          }
          return p;
        } catch { return p; }
      };
      const normalized = normalizePrev(prev);
      out.translations[ctx] = out.translations[ctx] || {};
      out.translations[ctx][msgid] = normalized;
      processed += 1;
      if (shouldFlush()) {
        try {
          const partial = gettextParser.po.compile(out);
          await atomicWrite(args.po, partial);
          console.log(`Flushed partial ${args.po} at ${processed}/${entries.length}`);
        } catch (e) {
          console.warn(`[warn] Failed to flush partial PO: ${e.message}`);
        }
      }
      if (args.limit && processed >= args.limit) break;
      if (args.sleep) await sleep(args.sleep * 1000);
      continue;
    }
    // Try translation memory before API call
    const tmCandidate = tm.get(msgid);
    if (tmCandidate) {
      const missingFromTM = placeholders.filter((ph) => !tmCandidate.includes(ph));
      if (missingFromTM.length === 0) {
        translation = tmCandidate;
      }
    }
    // If no TM hit, call API
    try {
      // Build Responses API input payload (messages moved to 'input')
      const input = [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: userContent },
          ],
        },
      ];
      const envMax = parseInt(process.env.AZURE_MAX_OUTPUT_TOKENS || '512', 10);
      const envEffort = process.env.AZURE_REASONING_EFFORT || 'low';
      const envTemp = process.env.AZURE_TEMPERATURE !== undefined ? parseFloat(process.env.AZURE_TEMPERATURE) : undefined;

      const doCall = async (maxTokens) => callAzureResponses({
        endpoint,
        apiKey,
        model,
        input,
        maxOutputTokens: maxTokens,
        temperature: envTemp,
        reasoningEffort: envEffort,
      });

      try {
        translation = await doCall(envMax);
      } catch (e) {
        if (e.code === 'incomplete_max_output_tokens') {
          console.warn(`[warn] Incomplete due to max_output_tokens; retrying with higher limit for: ${msgid.slice(0, 80)}...`);
          translation = await doCall(Math.max(envMax * 2, 1024));
        } else {
          throw e;
        }
      }
    } catch (e) {
      console.error(`[error] API call failed for: ${msgid.slice(0, 80)}... -> ${e.message}`);
      // Fallback to alternate model (e.g., gpt-4.1)
      try {
        const envMax = parseInt(process.env.AZURE_MAX_OUTPUT_TOKENS || '512', 10);
        const fallbackTemp = undefined; // avoid sending temperature if model rejects it
        console.warn(`[warn] Falling back to model ${fallbackModel} for: ${msgid.slice(0, 80)}...`);
        const input = [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: userContent },
            ],
          },
        ];
        const tryFallback = async (maxTokens) => callAzureResponses({
          endpoint,
          apiKey,
          model: fallbackModel,
          input,
          maxOutputTokens: maxTokens,
          temperature: fallbackTemp,
          reasoningEffort: undefined,
        });
        try {
          translation = await tryFallback(envMax);
        } catch (e2) {
          if (e2.code === 'incomplete_max_output_tokens') {
            console.warn(`[warn] Fallback incomplete due to max_output_tokens; retrying with higher limit for: ${msgid.slice(0, 80)}...`);
            translation = await tryFallback(Math.max(envMax * 2, 1024));
          } else {
            throw e2;
          }
        }
      } catch (e3) {
        console.error(`[error] Fallback model failed for: ${msgid.slice(0, 80)}... -> ${e3.message}`);
        translation = '';
      }
    }

    // Normalize edge newlines to match msgid to avoid msgfmt '\n' mismatch warnings
    if (translation != null) {
      translation = adjustEdgeNewlines(String(translation), msgid);
    }

    // Validate placeholder preservation; mark fuzzy if any missing
    const missing = placeholders.filter((ph) => !translation.includes(ph));
    const flags = { ...(item.flags || {}) };
    if (missing.length > 0) {
      console.warn(`[warn] Missing placeholders for msgid: ${msgid.slice(0, 80)}... -> ${missing.join(', ')}`);
      flags.fuzzy = true;
    }

    // Write entry
    out.translations[ctx] = out.translations[ctx] || {};
    const outItem = {
      msgctxt: item.msgctxt,
      msgid: item.msgid,
      msgid_plural: item.msgid_plural,
      comments: item.comments,
      extractedComments: item.extractedComments,
      references: item.references,
      msgstr: [],
      flags,
    };

    if (msgidPlural) {
      outItem.msgstr = [];
      outItem.msgstr[0] = translation || '';
    } else {
      outItem.msgstr = [translation || ''];
    }

    out.translations[ctx][item.msgid] = outItem;
    if (translation) {
      tm.set(msgid, translation);
    }

    // Echo translation to console for visibility
    try {
      if (translation) {
        console.log(`EN: ${msgid}`);
        console.log(`ID: ${translation}`);
      }
    } catch {}

    processed += 1;
    // Stream/flush partial PO to disk if requested
    if (shouldFlush()) {
      try {
        const partial = gettextParser.po.compile(out);
        await atomicWrite(args.po, partial);
        console.log(`Flushed partial ${args.po} at ${processed}/${entries.length}`);
      } catch (e) {
        console.warn(`[warn] Failed to flush partial PO: ${e.message}`);
      }
    }
    if (args.limit && processed >= args.limit) break;
    if (args.sleep) await sleep(args.sleep * 1000);
  }

  const poBuf = gettextParser.po.compile(out);
  await atomicWrite(args.po, poBuf);
  console.log(`Wrote ${args.po} with ${processed} translated entries.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

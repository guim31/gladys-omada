// -----------------------------------------------------------------------------
// Every text Gladys shows exists in the four languages of its interface
// (English, French, German, Spanish): the manifest, the message tables of the
// code, and the four docs with the same sections. German says "du", never the
// polite "Sie"; Spanish says "usted".
// -----------------------------------------------------------------------------

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LANGUAGES } from '../src/config.js';
import { NAMES, REASONS, TEXT, WIDGET_TEXT, format } from '../src/i18n.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

const LANGS = ['en', 'fr', 'de', 'es'];
const POLITE_GERMAN = /(?<!\p{L})(Sie|Ihr|Ihre|Ihren|Ihrem|Ihrer|Ihres)(?!\p{L})/u;
// Spanish addresses the user as "usted": no informal "tú" forms in the texts.
const INFORMAL_SPANISH =
  /(?<!\p{L})(tú|tu|tus|puedes|debes|quieres|tienes|añade|elige|introduce)(?!\p{L})/iu;

// Upper bounds, in characters: what the Gladys interface shows without cutting.
const MAX = {
  catalog: 100,
  widgetLabel: 30,
  label: 60,
  placeholder: 60,
  description: 300,
  message: 200,
  short: 24,
  featureName: 40,
};

const sorted = (keys) => [...keys].sort();

/** Checks one multi-language object; returns its problems. */
function problems(value, path, max) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [`${path} must be a multi-language object`];
  }
  const found = [];
  if (JSON.stringify(sorted(Object.keys(value))) !== JSON.stringify(sorted(LANGS))) {
    found.push(`${path} has [${Object.keys(value)}], expected exactly [${LANGS}]`);
  }
  for (const [lang, text] of Object.entries(value)) {
    found.push(...textProblems(text, `${path}.${lang}`, lang, max));
  }
  return found;
}

function textProblems(text, path, lang, max) {
  if (typeof text !== 'string' || text.trim() === '') {
    return [`${path} is empty`];
  }
  const found = [];
  if (text.length > max) {
    found.push(`${path} has ${text.length} characters (${max} at most)`);
  }
  if (lang === 'de' && POLITE_GERMAN.test(text)) {
    found.push(`${path} uses the polite form: "${text}"`);
  }
  if (lang === 'es' && INFORMAL_SPANISH.test(text)) {
    found.push(`${path} uses the informal form: "${text}"`);
  }
  return found;
}

/** Every multi-language object of the manifest, with its length limit. */
function manifestTexts(root) {
  const texts = [];
  const walk = (value, path, key) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`, key));
      return;
    }
    if (!value || typeof value !== 'object') {
      return;
    }
    const isText =
      ['label', 'description', 'placeholder'].includes(key) ||
      Object.keys(value).some((child) => LANGS.includes(child));
    if (isText) {
      // The store schema caps the catalog and widget descriptions, and widget labels.
      const max =
        path === 'manifest.description' || /^manifest\.widgets\[\d+\]\.description$/.test(path)
          ? MAX.catalog
          : /^manifest\.widgets\[\d+\]\.label$/.test(path)
            ? MAX.widgetLabel
            : (MAX[key] ?? MAX.label);
      texts.push({ path, value, max });
      return;
    }
    for (const [child, item] of Object.entries(value)) {
      walk(item, `${path}.${child}`, child);
    }
  };
  walk(root, 'manifest', null);
  return texts;
}

test('the configuration offers the four languages', () => {
  assert.deepEqual(LANGUAGES, LANGS);
  assert.deepEqual(Object.keys(NAMES), LANGS);
  const field = manifest.config_schema.find((f) => f.key === 'language');
  assert.deepEqual(
    field.options.map((o) => o.value),
    LANGS,
  );
  assert.equal(field.default, 'fr');
});

test('every text of the manifest is in English, French, German and Spanish', () => {
  const texts = manifestTexts(manifest);
  assert.ok(texts.length >= 100, `only ${texts.length} texts found in the manifest`);
  const found = texts.flatMap(({ path, value, max }) => problems(value, path, max));
  assert.deepEqual(found, []);
});

test('the name is the same in every language, 3 to 30 characters', () => {
  assert.equal(typeof manifest.name, 'string');
  assert.ok(manifest.name.length >= 3 && manifest.name.length <= 30);
});

test('the catalog description holds 10 characters at least in every language', () => {
  for (const lang of LANGS) {
    assert.ok(manifest.description[lang].length >= 10, `description.${lang} is too short`);
  }
});

test('every message table of the code has the four languages', () => {
  const longWidget = new Set(['notConfigured', 'waiting', 'devices']);
  const sample = {
    reason: 'x',
    detail: 'x',
    site: 'Default',
    version: '5.15',
    devices: 6,
    clients: 40,
  };
  const filled = (table) =>
    Object.fromEntries(
      Object.entries(table).map(([key, entry]) => [
        key,
        Object.fromEntries(Object.entries(entry).map(([l, t]) => [l, format(t, sample)])),
      ]),
    );
  const found = [
    ...Object.entries(filled(TEXT)).flatMap(([key, value]) =>
      problems(value, `TEXT.${key}`, MAX.message),
    ),
    ...Object.entries(filled(REASONS)).flatMap(([key, value]) =>
      problems(value, `REASONS.${key}`, MAX.message),
    ),
    ...Object.entries(WIDGET_TEXT).flatMap(([key, value]) =>
      problems(value, `WIDGET_TEXT.${key}`, longWidget.has(key) ? MAX.message : MAX.short),
    ),
  ];
  assert.deepEqual(found, []);
});

test('the feature names exist in every language', () => {
  const found = [];
  for (const lang of LANGS) {
    if (
      JSON.stringify(sorted(Object.keys(NAMES[lang]))) !==
      JSON.stringify(sorted(Object.keys(NAMES.en)))
    ) {
      found.push(`NAMES.${lang} does not have the keys of NAMES.en`);
    }
    for (const [key, value] of Object.entries(NAMES[lang])) {
      found.push(
        ...textProblems(
          format(value, { port: 'SFP WAN/LAN1' }),
          `NAMES.${lang}.${key}`,
          lang,
          MAX.featureName,
        ),
      );
    }
  }
  assert.deepEqual(found, []);
});

test('the four docs exist, with the same sections in the same order', async () => {
  const docs = {};
  for (const lang of LANGS) {
    docs[lang] = await readFile(new URL(`../docs/${lang}.md`, import.meta.url), 'utf8');
  }
  const outline = (text) =>
    text
      .split('\n')
      .filter((line) => /^#{1,3} /.test(line))
      .map((l) => l.match(/^#+/)[0]);
  const sections = (text) => text.split('\n').filter((line) => line.startsWith('## '));
  for (const lang of LANGS) {
    assert.ok(docs[lang].length >= 3000, `docs/${lang}.md is too short`);
    assert.deepEqual(
      outline(docs[lang]),
      outline(docs.en),
      `docs/${lang}.md: other headings than docs/en.md`,
    );
    assert.equal(sections(docs[lang]).length, 10, `docs/${lang}.md: 10 sections`);
    // Same structure: the same tables (row count) and the same scene examples.
    const rows = (text) => text.split('\n').filter((line) => line.startsWith('|')).length;
    assert.equal(rows(docs[lang]), rows(docs.en), `docs/${lang}.md: other tables than docs/en.md`);
  }
  // The things a user must read are said in every language.
  for (const [lang, words] of Object.entries({
    en: ['Developed without the hardware', 'Not affiliated with TP-Link', 'security camera'],
    fr: ['Développée sans le matériel', 'Sans lien avec TP-Link', 'caméra de sécurité'],
    de: ['Ohne die Hardware entwickelt', 'Keine Verbindung zu TP-Link', 'Überwachungskamera'],
    es: ['Desarrollada sin el hardware', 'Sin relación con TP-Link', 'cámara de seguridad'],
  })) {
    const flat = docs[lang].replace(/\s+/g, ' ');
    for (const word of words) {
      assert.ok(flat.includes(word), `docs/${lang}.md must say "${word}"`);
    }
  }
  assert.ok(!POLITE_GERMAN.test(docs.de), 'docs/de.md uses the polite form');
  assert.ok(!INFORMAL_SPANISH.test(docs.es), 'docs/es.md uses the informal form');
});

test('the guard catches a missing language, an empty text and the wrong form of address', () => {
  assert.equal(problems({ en: 'Light', fr: 'Éclairage', de: 'Licht' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'Light', fr: 'Éclairage', de: '', es: 'Luz' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'a', fr: 'a', de: 'a', es: 'a', it: 'a' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'a', fr: 'a', de: 'a'.repeat(61), es: 'a' }, 'x', 60).length, 1);
  for (const polite of [
    'Wählen Sie',
    'Ihr Gerät',
    'Ihre IP',
    'mit Ihrem',
    'Ihren',
    'Ihrer',
    'Ihres',
  ]) {
    assert.equal(problems({ en: 'a', fr: 'a', de: polite, es: 'a' }, 'x', 60).length, 1, polite);
  }
  for (const informal of ['Elige la red', 'tu teléfono', 'Puedes probar']) {
    assert.equal(
      problems({ en: 'a', fr: 'a', de: 'a', es: informal }, 'x', 60).length,
      1,
      informal,
    );
  }
  // Words that only contain the letters stay allowed.
  assert.deepEqual(
    problems({ en: 'a', fr: 'a', de: 'Siebenschläfer, ihre', es: 'a' }, 'x', 60),
    [],
  );
  // A manifest text forgotten in German is found.
  const forgotten = structuredClone(manifest);
  delete forgotten.actions[3].fields[0].placeholder.de;
  const found = manifestTexts(forgotten).flatMap(({ path, value, max }) =>
    problems(value, path, max),
  );
  assert.deepEqual(found, [
    'manifest.actions[3].fields[0].placeholder has [en,fr,es], expected exactly [en,fr,de,es]',
  ]);
});

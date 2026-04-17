import { readdirSync, existsSync } from 'fs';
import { join, relative } from 'path';

const locales = [
  'en', 'es', 'zh', 'tl', 'vi', 'ar', 'fr', 'ht', 'ko', 'ru', 'hi', 'pt', 'de',
  'uk', 'fa', 'tr', 'ku', 'so', 'am', 'my', 'quc', 'mix',
];

const contentDir = join(import.meta.dir, '..', 'src', 'content');
let exitCode = 0;

function checkDir(basePath: string, requiredFiles: string[]) {
  const results: Record<string, string[]> = {};
  for (const locale of locales) {
    const missing: string[] = [];
    for (const file of requiredFiles) {
      const fullPath = join(basePath, locale, file);
      if (!existsSync(fullPath)) {
        missing.push(file);
      }
    }
    if (missing.length > 0) {
      results[locale] = missing;
    }
  }
  return results;
}

function checkDocsTree(basePath: string) {
  const enDir = join(basePath, 'en');
  if (!existsSync(enDir)) return {};

  function getFiles(dir: string): string[] {
    const entries = readdirSync(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...getFiles(fullPath));
      } else if (entry.name.endsWith('.md')) {
        files.push(relative(enDir, fullPath));
      }
    }
    return files;
  }

  const enFiles = getFiles(enDir);
  const results: Record<string, string[]> = {};
  for (const locale of locales) {
    const missing: string[] = [];
    for (const file of enFiles) {
      const fullPath = join(basePath, locale, file);
      if (!existsSync(fullPath)) {
        missing.push(file);
      }
    }
    if (missing.length > 0) {
      results[locale] = missing;
    }
  }
  return results;
}

console.log('=== Checking page translations ===\n');
const pageGaps = checkDir(join(contentDir, 'pages'), ['features.md', 'security.md']);
for (const [locale, missing] of Object.entries(pageGaps)) {
  console.log(`  ${locale}: missing ${missing.join(', ')}`);
  exitCode = 1;
}
if (Object.keys(pageGaps).length === 0) {
  console.log('  All locales have complete page translations. ✅');
}

console.log('\n=== Checking doc translations ===\n');
const docGaps = checkDocsTree(join(contentDir, 'docs'));
for (const [locale, missing] of Object.entries(docGaps)) {
  console.log(`  ${locale}: missing ${missing.length} files`);
  for (const file of missing) {
    console.log(`    - ${file}`);
  }
  exitCode = 1;
}
if (Object.keys(docGaps).length === 0) {
  console.log('  All locales have complete doc translations. ✅');
}

if (exitCode === 0) {
  console.log('\nAll translations are complete! 🎉');
} else {
  console.log('\nSome translations are missing. See above for details.');
}

process.exit(exitCode);

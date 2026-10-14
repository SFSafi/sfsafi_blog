import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
const names = [
  '0001_engagement.sql',
  '0002_profile.sql',
  '0003_locations.sql',
  '0004_search.sql',
  '0005_content.sql',
  '0006_comments.sql',
  '0007_comment_email.sql',
  '0008_site_settings.sql',
];
const migrations = names.map((name) => {
  const sql = readFileSync(
    new URL('../migrations/' + name, import.meta.url),
    'utf8',
  ).replace(/^--.*$/gm, '');
  const statements =
    sql.match(/CREATE TRIGGER[\s\S]*?\n\s*END;|CREATE TABLE[\s\S]*?;/g) || [];
  if (
    !statements.length ||
    statements.some(
      (statement) => !/^CREATE (TABLE|TRIGGER) IF NOT EXISTS/.test(statement),
    )
  )
    throw new Error(
      'Initial bootstrap only accepts additive idempotent schema',
    );
  let remaining = sql;
  for (const statement of statements)
    remaining = remaining.replace(statement, '');
  if (remaining.trim()) throw new Error('Unparsed schema statement');
  return { name, statements };
});
const output = new URL('../worker/generated/', import.meta.url);
mkdirSync(output, { recursive: true });
writeFileSync(
  new URL('schema.ts', output),
  '// Generated from migrations by npm prepare. Do not edit.\nexport const initialMigrations = ' +
    JSON.stringify(migrations, null, 2) +
    ';\n',
);

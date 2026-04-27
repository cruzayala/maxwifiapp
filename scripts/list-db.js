const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const tables = await prisma.$queryRawUnsafe(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma%' ORDER BY name;"
  );
  console.log('=== TABLAS EN DB (' + tables.length + ') ===');
  tables.forEach(t => console.log('  ' + t.name));

  const indices = await prisma.$queryRawUnsafe(
    "SELECT tbl_name, name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY tbl_name, name;"
  );
  console.log('\n=== INDICES (' + indices.length + ') ===');
  let lastTable = '';
  indices.forEach(i => {
    if (i.tbl_name !== lastTable) { console.log('\n  [' + i.tbl_name + ']'); lastTable = i.tbl_name; }
    console.log('    ' + i.name);
  });

  await prisma.$disconnect();
}
main().catch(console.error);

import fs from 'fs';
for (const date of ['2026-07-27', '2026-07-28', '2026-07-29', '2026-07-30']) {
  const d = JSON.parse(fs.readFileSync(`data/digests/${date}.json`, 'utf8'));
  console.log(`=== ${date} ===`);
  console.log(d.title);
  d.items.forEach(it => console.log('-', it.title, '|', it.url));
  console.log('x_highlights:');
  (d.x_highlights || []).forEach(x => console.log('-', x.title, x.url));
  console.log('growth_actions:');
  (d.growth_actions || []).forEach(g => console.log('-', g.type, g.description.slice(0, 100)));
}

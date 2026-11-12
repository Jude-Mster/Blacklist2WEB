'use strict';
// Usage: npm run make-admin -- <account_id>
// The account must already exist on the website (register or log in once first).
const db = require('../src/db');

(async () => {
  const id = (process.argv[2] || '').trim();
  if (!id) { console.error('Usage: npm run make-admin -- <account_id>'); process.exit(1); }
  const res = await db.run("UPDATE users SET role = 'admin' WHERE account_id = ?", [id]);
  console.log(res.affectedRows ? `${id} is now an admin` : `No website user called ${id}`);
  await db.pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });

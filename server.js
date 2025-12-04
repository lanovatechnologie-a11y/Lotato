// === MODIFICATIONS POUR LES NOMS DE TABLES FRANÇAIS ===

// Dans la route /api/login :
const result = await pool.query(
  'SELECT * FROM "codes d\'accès" WHERE code = $1',  // Notez les guillemets et l'échappement
  [code]
);

// Mettre à jour le code avec l'ID de l'appareil
await pool.query(
  'UPDATE "codes d\'accès" SET device_id = $1, last_used = NOW() WHERE code = $2',
  [device_id, code]
);

// Enregistrer ou mettre à jour le terminal
await pool.query(
  `INSERT INTO terminaux (device_id, agent_id, status, last_seen) 
   VALUES ($1, $2, 'connected', NOW())
   ON CONFLICT (device_id) 
   DO UPDATE SET status = 'connected', last_seen = NOW()`,
  [device_id, agentId]
);

// Dans /api/terminals :
const result = await pool.query(
  'SELECT * FROM terminaux ORDER BY last_seen DESC'
);

// Dans /api/tickets :
const result = await pool.query(
  `INSERT INTO billets 
   (ticket_number, device_id, agent_id, draw, draw_time, bets, total, created_at) 
   VALUES ($1, $2, $3, $4, $5, $6, $7, NOW()) 
   RETURNING *`,
  [ticket_number, device_id, agent_id, draw, draw_time, JSON.stringify(bets), total]
);

// Mettre à jour le dernier ticket du terminal
await pool.query(
  'UPDATE terminaux SET last_seen = NOW() WHERE device_id = $1',
  [device_id]
);

// Dans /api/codes :
const result = await pool.query(
  'SELECT * FROM "codes d\'accès" ORDER BY created_at DESC'
);

// Dans /api/codes/generate :
await pool.query(
  'INSERT INTO "codes d\'accès" (code, type) VALUES ($1, $2)',
  [code, type]
);

// Dans /api/codes/deactivate :
await pool.query(
  'UPDATE "codes d\'accès" SET active = false WHERE code = $1',
  [code]
);

// Dans /api/winners :
const result = await pool.query(
  'SELECT * FROM gagnants ORDER BY created_at DESC LIMIT 10'
);

// Dans /api/winners (POST) :
const result = await pool.query(
  'INSERT INTO gagnants (draw, numbers, created_at) VALUES ($1, $2, NOW()) RETURNING *',
  [draw, numbers]
);

// Dans /api/stats :
// Tickets du jour
const ticketsResult = await pool.query(
  `SELECT COUNT(*) as count, COALESCE(SUM(total), 0) as total 
   FROM billets 
   WHERE DATE(created_at) = $1`,
  [today]
);

// Terminaux actifs
const terminalsResult = await pool.query(
  `SELECT COUNT(*) as active 
   FROM terminaux 
   WHERE last_seen > NOW() - INTERVAL '5 minutes'`
);

// Total des terminaux
const totalTerminalsResult = await pool.query(
  'SELECT COUNT(*) as total FROM terminaux'
);

// Codes actifs
const activeCodesResult = await pool.query(
  `SELECT COUNT(*) as active_codes FROM "codes d\'accès" WHERE active = true`
);
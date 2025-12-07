const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 10000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Pour servir les fichiers HTML

// 🔧 CONFIGURATION AMÉLIORÉE DE LA BASE DE DONNÉES
console.log('=== Configuration Database ===');
console.log('PORT:', process.env.PORT || 10000);
console.log('NODE_ENV:', process.env.NODE_ENV || 'development');

// URL de connexion avec fallback
const databaseUrl = process.env.DATABASE_URL || 
                   'postgresql://postgres:Myster44@db.fpekfulgjuycwzybiznt.supabase.co:5432/postgres';

console.log('🔗 Tentative de connexion à:', databaseUrl.split('@')[1]?.split(':')[0]);

// Configuration du pool de connexions
const pool = new Pool({
  connectionString: databaseUrl,
  ssl: {
    rejectUnauthorized: false
  },
  connectionTimeoutMillis: 10000, // 10 secondes timeout
  idleTimeoutMillis: 30000,
  max: 20 // Nombre maximum de clients dans le pool
});

// Gestion des erreurs du pool
pool.on('error', (err) => {
  console.error('❌ Erreur inattendue du pool PostgreSQL:', err.message);
  console.error('Stack:', err.stack);
});

// 🛠️ FONCTION DE TEST DE CONNEXION AMÉLIORÉE
async function testDatabaseConnection() {
  let client;
  try {
    console.log('🔄 Test de connexion à la base de données...');
    
    client = await pool.connect();
    console.log('✅ Connexion DB réussie!');
    
    // Vérifier les tables disponibles
    const tables = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);
    
    console.log('📊 Tables disponibles dans public:');
    tables.rows.forEach((row, index) => {
      console.log(`  ${index + 1}. ${row.table_name}`);
    });
    
    // Vérifier les "codes d'accès"
    try {
      const codesResult = await client.query(`
        SELECT COUNT(*) as count 
        FROM "codes d'accès"
      `);
      console.log(`🔑 Codes d'accès: ${codesResult.rows[0].count} enregistrements`);
    } catch (codesError) {
      console.log('⚠️ Table "codes d\'accès" non trouvée ou erreur d\'accès');
    }
    
    // Vérifier les "terminaux"
    try {
      const terminalsResult = await client.query(`
        SELECT COUNT(*) as count 
        FROM terminaux
      `);
      console.log(`💻 Terminaux: ${terminalsResult.rows[0].count} enregistrements`);
    } catch (terminalsError) {
      console.log('⚠️ Table "terminaux" non trouvée ou erreur d\'accès');
    }
    
    // Vérifier les "billets"
    try {
      const ticketsResult = await client.query(`
        SELECT COUNT(*) as count 
        FROM billets
      `);
      console.log(`🎫 Billets: ${ticketsResult.rows[0].count} enregistrements`);
    } catch (ticketsError) {
      console.log('⚠️ Table "billets" non trouvée ou erreur d\'accès');
    }
    
    client.release();
    
  } catch (error) {
    console.error('❌ Échec de la connexion à la base de données:');
    console.error('   Message:', error.message);
    console.error('   Code:', error.code);
    console.error('   Detail:', error.detail);
    console.error('   Hint:', error.hint);
    
    if (client) client.release();
    
    // Suggestions de résolution
    console.log('\n🔧 Suggestions de dépannage:');
    console.log('   1. Vérifiez l\'URL de connexion dans les variables d\'environnement');
    console.log('   2. Vérifiez les permissions de l\'utilisateur postgres dans Supabase');
    console.log('   3. Assurez-vous que la base de données est accessible depuis Render');
    console.log('   4. Vérifiez les règles de pare-feu dans Supabase');
    
    // Tentative de connexion alternative
    console.log('\n🔄 Tentative avec URL simplifiée...');
    try {
      const simpleUrl = 'postgresql://postgres:Myster44@db.fpekfulgjuycwzybiznt.supabase.co/postgres';
      const simplePool = new Pool({
        connectionString: simpleUrl,
        ssl: { rejectUnauthorized: false }
      });
      const simpleClient = await simplePool.connect();
      console.log('✅ Connexion avec URL simplifiée réussie!');
      simpleClient.release();
      simplePool.end();
    } catch (simpleError) {
      console.error('❌ Échec avec URL simplifiée:', simpleError.message);
    }
  }
}

// Appeler la fonction de test au démarrage
testDatabaseConnection();

// Routes API
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    database: 'Connected',
    timestamp: new Date().toISOString(),
    service: 'Nova Lotto API'
  });
});

// Route de test détaillée de la base de données
app.get('/api/test-db', async (req, res) => {
  let client;
  try {
    client = await pool.connect();
    
    // Tester la connexion de base
    const timeResult = await client.query('SELECT NOW() as current_time, version() as version');
    
    // Vérifier les tables
    const tablesResult = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);
    
    client.release();
    
    res.json({ 
      success: true, 
      message: 'Connexion DB réussie',
      database: {
        current_time: timeResult.rows[0].current_time,
        version: timeResult.rows[0].version,
        tables: tablesResult.rows.map(row => row.table_name),
        tables_count: tablesResult.rows.length
      }
    });
  } catch (error) {
    console.error('Erreur API test-db:', error);
    
    if (client) client.release();
    
    res.status(500).json({ 
      success: false, 
      message: 'Erreur de connexion DB',
      error: error.message,
      code: error.code,
      detail: error.detail,
      hint: 'Vérifiez les variables d\'environnement DATABASE_URL'
    });
  }
});

// Route pour les terminaux
app.get('/api/terminals', async (req, res) => {
  let client;
  try {
    client = await pool.connect();
    
    // Essayer différentes tables possibles
    let result;
    try {
      result = await client.query('SELECT * FROM terminaux ORDER BY last_seen DESC');
    } catch (error) {
      // Essayer avec le nom anglais
      result = await client.query('SELECT * FROM terminals ORDER BY last_seen DESC');
    }
    
    client.release();
    res.json(result.rows);
  } catch (error) {
    console.error('Erreur GET /api/terminals:', error);
    
    if (client) client.release();
    
    res.status(500).json({ 
      error: error.message,
      suggestion: 'Vérifiez le nom de la table (terminaux ou terminals)'
    });
  }
});

// Route pour les tickets
app.post('/api/tickets', async (req, res) => {
  let client;
  try {
    const { ticket_number, device_id, agent_id, draw, draw_time, bets, total } = req.body;
    
    console.log('🎟️ Nouveau ticket:', { ticket_number, device_id, total });
    
    client = await pool.connect();
    
    // Essayer avec différentes tables possibles
    let result;
    try {
      result = await client.query(
        `INSERT INTO billets 
         (ticket_number, device_id, agent_id, draw, draw_time, bets, total, created_at) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW()) 
         RETURNING *`,
        [ticket_number, device_id, agent_id, draw, draw_time, JSON.stringify(bets), total]
      );
    } catch (error) {
      // Essayer avec le nom anglais
      result = await client.query(
        `INSERT INTO tickets 
         (ticket_number, device_id, agent_id, draw, draw_time, bets, total, created_at) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW()) 
         RETURNING *`,
        [ticket_number, device_id, agent_id, draw, draw_time, JSON.stringify(bets), total]
      );
    }
    
    client.release();
    
    console.log('✅ Ticket enregistré avec ID:', result.rows[0].id);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Erreur POST /api/tickets:', error);
    
    if (client) client.release();
    
    res.status(500).json({ 
      error: error.message,
      suggestion: 'Vérifiez la structure de la table billets/tickets'
    });
  }
});

// Route pour les codes d'accès
app.post('/api/login', async (req, res) => {
  let client;
  try {
    const { code, device_id } = req.body;
    
    console.log('🔑 Tentative de login avec code:', code);
    
    client = await pool.connect();
    
    // Essayer avec différentes tables possibles
    let result;
    try {
      result = await client.query(
        `SELECT * FROM "codes d'accès" WHERE code = $1 AND active = true`,
        [code]
      );
    } catch (error) {
      // Essayer avec le nom anglais sans accents
      result = await client.query(
        `SELECT * FROM access_codes WHERE code = $1 AND active = true`,
        [code]
      );
    }
    
    if (result.rows.length === 0) {
      client.release();
      return res.status(401).json({ 
        error: 'Code invalide ou inactif',
        code_provided: code 
      });
    }
    
    const agentId = result.rows[0].id;
    
    // Mettre à jour le code avec l'ID de l'appareil
    try {
      await client.query(
        `UPDATE "codes d'accès" SET device_id = $1, last_used = NOW() WHERE code = $2`,
        [device_id, code]
      );
    } catch (error) {
      await client.query(
        `UPDATE access_codes SET device_id = $1, last_used = NOW() WHERE code = $2`,
        [device_id, code]
      );
    }
    
    // Enregistrer ou mettre à jour le terminal
    try {
      await client.query(
        `INSERT INTO terminaux (device_id, agent_id, status, last_seen) 
         VALUES ($1, $2, 'connected', NOW())
         ON CONFLICT (device_id) 
         DO UPDATE SET status = 'connected', last_seen = NOW()`,
        [device_id, agentId]
      );
    } catch (error) {
      await client.query(
        `INSERT INTO terminals (device_id, agent_id, status, last_seen) 
         VALUES ($1, $2, 'connected', NOW())
         ON CONFLICT (device_id) 
         DO UPDATE SET status = 'connected', last_seen = NOW()`,
        [device_id, agentId]
      );
    }
    
    client.release();
    
    console.log('✅ Login réussi pour agent ID:', agentId);
    
    res.json({ 
      success: true, 
      message: 'Connexion réussie',
      agent: result.rows[0]
    });
  } catch (error) {
    console.error('Erreur POST /api/login:', error);
    
    if (client) client.release();
    
    res.status(500).json({ 
      error: error.message,
      suggestion: 'Vérifiez les tables codes d\'accès et terminaux'
    });
  }
});

// Route pour créer les tables si elles n'existent pas
app.get('/api/setup-db', async (req, res) => {
  let client;
  try {
    client = await pool.connect();
    
    // Créer la table codes d'accès si elle n'existe pas
    await client.query(`
      CREATE TABLE IF NOT EXISTS "codes d'accès" (
        id SERIAL PRIMARY KEY,
        code VARCHAR(50) UNIQUE NOT NULL,
        active BOOLEAN DEFAULT true,
        device_id VARCHAR(100),
        last_used TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    // Créer la table terminaux si elle n'existe pas
    await client.query(`
      CREATE TABLE IF NOT EXISTS terminaux (
        id SERIAL PRIMARY KEY,
        device_id VARCHAR(100) UNIQUE NOT NULL,
        agent_id INTEGER,
        status VARCHAR(20) DEFAULT 'disconnected',
        sales DECIMAL DEFAULT 0,
        last_seen TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    // Créer la table billets si elle n'existe pas
    await client.query(`
      CREATE TABLE IF NOT EXISTS billets (
        id SERIAL PRIMARY KEY,
        ticket_number VARCHAR(50) NOT NULL,
        device_id VARCHAR(100),
        agent_id INTEGER,
        draw VARCHAR(50),
        draw_time VARCHAR(20),
        bets JSONB,
        total DECIMAL NOT NULL,
        synced BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    // Ajouter des données de test
    await client.query(`
      INSERT INTO "codes d'accès" (code, active) 
      VALUES 
        ('ADMIN123', true),
        ('CONTROL456', true),
        ('123456', true),
        ('lottery2024', true)
      ON CONFLICT (code) DO NOTHING
    `);
    
    client.release();
    
    res.json({ 
      success: true, 
      message: 'Tables créées avec succès',
      tables_created: ["codes d'accès", "terminaux", "billets"]
    });
  } catch (error) {
    console.error('Erreur /api/setup-db:', error);
    
    if (client) client.release();
    
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Route pour obtenir les statistiques
app.get('/api/stats', async (req, res) => {
  let client;
  try {
    client = await pool.connect();
    
    const stats = {
      total_agents: 0,
      active_agents: 0,
      pending_tickets: 0,
      total_sales: 0
    };
    
    // Compter les agents actifs (codes actifs)
    try {
      const agentsResult = await client.query(`
        SELECT COUNT(*) as count FROM "codes d'accès" WHERE active = true
      `);
      stats.total_agents = parseInt(agentsResult.rows[0].count);
    } catch (error) {
      console.log('Erreur comptage agents:', error.message);
    }
    
    // Compter les terminaux connectés
    try {
      const activeResult = await client.query(`
        SELECT COUNT(*) as count FROM terminaux 
        WHERE status = 'connected' AND last_seen > NOW() - INTERVAL '5 minutes'
      `);
      stats.active_agents = parseInt(activeResult.rows[0].count);
    } catch (error) {
      console.log('Erreur comptage terminaux actifs:', error.message);
    }
    
    // Compter les tickets en attente
    try {
      const pendingResult = await client.query(`
        SELECT COUNT(*) as count FROM billets WHERE synced = false
      `);
      stats.pending_tickets = parseInt(pendingResult.rows[0].count);
    } catch (error) {
      console.log('Erreur comptage tickets en attente:', error.message);
    }
    
    // Calculer le total des ventes
    try {
      const salesResult = await client.query(`
        SELECT COALESCE(SUM(total), 0) as total FROM billets
      `);
      stats.total_sales = parseFloat(salesResult.rows[0].total);
    } catch (error) {
      console.log('Erreur calcul ventes:', error.message);
    }
    
    client.release();
    
    res.json(stats);
  } catch (error) {
    console.error('Erreur GET /api/stats:', error);
    
    if (client) client.release();
    
    res.status(500).json({ 
      error: error.message,
      stats: {
        total_agents: 0,
        active_agents: 0,
        pending_tickets: 0,
        total_sales: 0
      }
    });
  }
});

// Middleware pour les erreurs 404
app.use((req, res) => {
  res.status(404).json({
    error: 'Route non trouvée',
    available_routes: [
      'GET  /api/health',
      'GET  /api/test-db',
      'GET  /api/terminals',
      'POST /api/tickets',
      'POST /api/login',
      'GET  /api/setup-db',
      'GET  /api/stats'
    ]
  });
});

// Démarrer le serveur
app.listen(PORT, () => {
  console.log(`\n🚀 Serveur Nova Lotto démarré sur le port ${PORT}`);
  console.log(`📡 API disponible sur: http://localhost:${PORT}/api/health`);
  console.log(`🌐 Interface web sur: http://localhost:${PORT}/index.html`);
  console.log(`🎮 Panneau de contrôle: http://localhost:${PORT}/composition 2.html`);
  console.log(`\n📊 Pour tester la connexion DB: http://localhost:${PORT}/api/test-db`);
  console.log(`🔧 Pour créer les tables: http://localhost:${PORT}/api/setup-db`);
});
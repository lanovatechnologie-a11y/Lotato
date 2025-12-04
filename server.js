const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors({
  origin: '*', // Permettre toutes les origines pour le test
  credentials: true
}));
app.use(express.json());

// IMPORTANT: Serve static files from current directory (for assets if needed)
app.use(express.static(__dirname));

// Connexion PostgreSQL à Supabase
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { 
    rejectUnauthorized: false 
  }
});

// Test de connexion DB
pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Erreur de connexion à la base de données:', err.stack);
  } else {
    console.log('✅ Connecté à Supabase PostgreSQL');
    
    // Tester une requête simple
    client.query('SELECT NOW()', (err, res) => {
      release();
      if (err) {
        console.error('❌ Erreur lors de la requête test:', err.stack);
      } else {
        console.log('📊 Base de données accessible, heure:', res.rows[0].now);
      }
    });
  }
});

// === ROUTES POUR LES PAGES ===

// Route principale : application de jeu
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Route pour le centre de contrôle
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'composition 2.html'));
});

// === API ROUTES POUR L'APPLICATION MOBILE ===

// Vérification santé
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    time: new Date().toISOString(),
    database: 'connected',
    environment: process.env.NODE_ENV,
    port: process.env.PORT
  });
});

// Connexion avec vérification dans la base de données
app.post('/api/login', async (req, res) => {
  const { code, device_id } = req.body;
  
  try {
    // Vérifier si le code existe dans la base de données
    const result = await pool.query(
      'SELECT * FROM access_codes WHERE code = $1 AND active = true',
      [code]
    );
    
    if (result.rows.length === 0) {
      return res.status(401).json({ 
        success: false, 
        error: "Kòd sekirite a pa kòrèk oswa inaktif" 
      });
    }
    
    const codeData = result.rows[0];
    
    // Vérifier si le code est déjà utilisé sur un autre appareil
    if (codeData.device_id && codeData.device_id !== device_id) {
      return res.status(403).json({ 
        success: false, 
        error: "Kòd sa a deja itilize sou yon lòt aparèy" 
      });
    }
    
    // Mettre à jour le code avec l'ID de l'appareil
    await pool.query(
      'UPDATE access_codes SET device_id = $1, last_used = NOW() WHERE code = $2',
      [device_id, code]
    );
    
    // Enregistrer ou mettre à jour le terminal
    const agentId = `agent_${device_id.substring(0, 8)}`;
    
    await pool.query(
      `INSERT INTO terminals (device_id, agent_id, status, last_seen) 
       VALUES ($1, $2, 'connected', NOW())
       ON CONFLICT (device_id) 
       DO UPDATE SET status = 'connected', last_seen = NOW()`,
      [device_id, agentId]
    );
    
    res.json({ 
      success: true, 
      code, 
      device_id, 
      agent_id: agentId 
    });
    
  } catch (err) {
    console.error('❌ Erreur login:', err);
    res.status(500).json({ 
      error: err.message,
      details: "Erreur serveur lors de la connexion" 
    });
  }
});

// Récupérer les terminaux
app.get('/api/terminals', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM terminals ORDER BY last_seen DESC'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('❌ Erreur récupération terminaux:', err);
    res.status(500).json({ error: err.message });
  }
});

// Enregistrer un ticket
app.post('/api/tickets', async (req, res) => {
  try {
    const { 
      ticket_number, 
      device_id, 
      agent_id, 
      draw, 
      draw_time, 
      bets, 
      total 
    } = req.body;
    
    const result = await pool.query(
      `INSERT INTO tickets 
       (ticket_number, device_id, agent_id, draw, draw_time, bets, total, created_at) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW()) 
       RETURNING *`,
      [ticket_number, device_id, agent_id, draw, draw_time, JSON.stringify(bets), total]
    );
    
    // Mettre à jour le dernier ticket du terminal
    await pool.query(
      'UPDATE terminals SET last_seen = NOW() WHERE device_id = $1',
      [device_id]
    );
    
    res.json({ 
      success: true, 
      ticket: result.rows[0] 
    });
    
  } catch (err) {
    console.error('❌ Erreur enregistrement ticket:', err);
    res.status(500).json({ error: err.message });
  }
});

// Récupérer les tickets d'un agent
app.get('/api/tickets/:agent_id', async (req, res) => {
  try {
    const { agent_id } = req.params;
    const result = await pool.query(
      'SELECT * FROM tickets WHERE agent_id = $1 ORDER BY created_at DESC LIMIT 50',
      [agent_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('❌ Erreur récupération tickets:', err);
    res.status(500).json({ error: err.message });
  }
});

// Générer des codes d'accès (pour l'admin)
app.post('/api/codes/generate', async (req, res) => {
  try {
    const { count, type } = req.body;
    const codes = [];
    
    for (let i = 0; i < count; i++) {
      const code = type === 'admin' ? 
        `ADM${Math.random().toString(36).substr(2, 6).toUpperCase()}` :
        `AGT${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
      
      codes.push(code);
      
      await pool.query(
        'INSERT INTO access_codes (code, type) VALUES ($1, $2)',
        [code, type]
      );
    }
    
    res.json({ 
      success: true, 
      codes,
      count: codes.length
    });
    
  } catch (err) {
    console.error('❌ Erreur génération codes:', err);
    res.status(500).json({ error: err.message });
  }
});

// Liste des codes d'accès
app.get('/api/codes', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM access_codes ORDER BY created_at DESC'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('❌ Erreur liste codes:', err);
    res.status(500).json({ error: err.message });
  }
});

// Désactiver un code
app.post('/api/codes/deactivate', async (req, res) => {
  try {
    const { code } = req.body;
    
    await pool.query(
      'UPDATE access_codes SET active = false WHERE code = $1',
      [code]
    );
    
    res.json({ success: true });
    
  } catch (err) {
    console.error('❌ Erreur désactivation code:', err);
    res.status(500).json({ error: err.message });
  }
});

// Récupérer les gagnants
app.get('/api/winners', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM winners ORDER BY created_at DESC LIMIT 10'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('❌ Erreur récupération gagnants:', err);
    res.status(500).json({ error: err.message });
  }
});

// Ajouter un gagnant (pour l'admin)
app.post('/api/winners', async (req, res) => {
  try {
    const { draw, numbers } = req.body;
    
    const result = await pool.query(
      'INSERT INTO winners (draw, numbers, created_at) VALUES ($1, $2, NOW()) RETURNING *',
      [draw, numbers]
    );
    
    res.json({ 
      success: true, 
      winner: result.rows[0] 
    });
    
  } catch (err) {
    console.error('❌ Erreur ajout gagnant:', err);
    res.status(500).json({ error: err.message });
  }
});

// Statistiques
app.get('/api/stats', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    
    // Tickets du jour
    const ticketsResult = await pool.query(
      `SELECT COUNT(*) as count, COALESCE(SUM(total), 0) as total 
       FROM tickets 
       WHERE DATE(created_at) = $1`,
      [today]
    );
    
    // Terminaux actifs
    const terminalsResult = await pool.query(
      `SELECT COUNT(*) as active 
       FROM terminals 
       WHERE last_seen > NOW() - INTERVAL '5 minutes'`
    );
    
    res.json({
      date: today,
      tickets_today: parseInt(ticketsResult.rows[0].count),
      total_today: parseFloat(ticketsResult.rows[0].total),
      active_terminals: parseInt(terminalsResult.rows[0].active)
    });
    
  } catch (err) {
    console.error('❌ Erreur stats:', err);
    res.status(500).json({ error: err.message });
  }
});

// Route de test pour vérifier le déploiement
app.get('/api/test', (req, res) => {
  res.json({
    message: 'Nova Lotto API fonctionne!',
    timestamp: new Date().toISOString(),
    directory: __dirname,
    files: ['server.js', 'package.json', 'index.html', 'composition 2.html']
  });
});

// Gestion des erreurs 404
app.use((req, res, next) => {
  res.status(404).json({ 
    error: 'Route non trouvée',
    path: req.path 
  });
});

// Gestion des erreurs globales
app.use((err, req, res, next) => {
  console.error('❌ Erreur serveur:', err.stack);
  res.status(500).json({ 
    error: 'Erreur interne du serveur',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Veuillez contacter l\'administrateur'
  });
});

// Démarrage
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`========================================`);
  console.log(`✅ Serveur Nova Lotto démarré sur le port ${PORT}`);
  console.log(`🌍 Environnement: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📁 Répertoire: ${__dirname}`);
  console.log(`🌐 Application: http://localhost:${PORT}`);
  console.log(`🛠️  Admin: http://localhost:${PORT}/admin`);
  console.log(`📊 API Health: http://localhost:${PORT}/api/health`);
  console.log(`🔧 API Test: http://localhost:${PORT}/api/test`);
  console.log(`========================================`);
});
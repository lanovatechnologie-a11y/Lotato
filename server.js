const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 10000;

// Middleware
app.use(cors());
app.use(express.json());

// CONFIGURATION DE LA BASE DE DONNÉES (votre code existant reste ici)
// ... [gardez tout votre code de configuration DB] ...

// ===== ROUTES API (existent déjà) =====
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    database: 'Connected',
    timestamp: new Date().toISOString(),
    service: 'Nova Lotto API'
  });
});

// ... [gardez toutes vos routes API existantes] ...

// ===== ROUTES POUR LES PAGES HTML =====

// Route pour la page d'accueil (index.html)
app.get('/', (req, res) => {
  // Essayez différents noms de fichiers
  const possibleFiles = [
    'index .html',
    'index.html',
    'index .html'
  ];
  
  for (const file of possibleFiles) {
    try {
      if (require('fs').existsSync(path.join(__dirname, file))) {
        return res.sendFile(path.join(__dirname, file));
      }
    } catch (e) {
      continue;
    }
  }
  
  // Si aucun fichier n'est trouvé, renvoyer un message simple
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Nova Lotto</title>
      <style>
        body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
        h1 { color: #3498db; }
        a { color: #e74c3c; text-decoration: none; font-weight: bold; }
      </style>
    </head>
    <body>
      <h1>Nova Lotto Server</h1>
      <p>Serveur fonctionnel !</p>
      <p><a href="/api/health">Vérifier l'état de l'API</a></p>
      <p><a href="/composition-2">Accéder au panneau de contrôle</a></p>
    </body>
    </html>
  `);
});

// Route pour le panneau de contrôle
app.get('/composition-2', (req, res) => {
  const possibleFiles = [
    'composition 2.html',
    'composition-2.html',
    'composition2.html'
  ];
  
  for (const file of possibleFiles) {
    try {
      if (require('fs').existsSync(path.join(__dirname, file))) {
        return res.sendFile(path.join(__dirname, file));
      }
    } catch (e) {
      continue;
    }
  }
  
  res.status(404).send('Page non trouvée');
});

// Route pour servir le logo
app.get('/logo-borlette.jpg', (req, res) => {
  try {
    if (require('fs').existsSync(path.join(__dirname, 'logo-borlette.jpg'))) {
      return res.sendFile(path.join(__dirname, 'logo-borlette.jpg'));
    }
  } catch (e) {
    // Fichier non trouvé
  }
  res.status(404).send('Logo non trouvé');
});

// Route de test simple
app.get('/test', (req, res) => {
  res.json({ 
    success: true, 
    message: 'Serveur Nova Lotto fonctionnel',
    endpoints: [
      '/api/health',
      '/api/test-db',
      '/',
      '/composition-2',
      '/test'
    ]
  });
});

// ===== MIDDLEWARE 404 AMÉLIORÉ =====
app.use((req, res) => {
  // Si c'est une route API, renvoyer du JSON
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({
      error: 'Route API non trouvée',
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
  }
  
  // Sinon, renvoyer une page HTML
  res.status(404).send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Page non trouvée - Nova Lotto</title>
      <style>
        body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
        h1 { color: #e74c3c; }
        a { color: #3498db; text-decoration: none; }
      </style>
    </head>
    <body>
      <h1>404 - Page non trouvée</h1>
      <p>La page que vous recherchez n'existe pas.</p>
      <p><a href="/">Retour à l'accueil</a></p>
      <p><a href="/api/health">Vérifier l'API</a></p>
    </body>
    </html>
  `);
});

// Démarrer le serveur (votre code existant)
app.listen(PORT, () => {
  console.log(`\n🚀 Serveur Nova Lotto démarré sur le port ${PORT}`);
  console.log(`🌐 Accueil: http://localhost:${PORT}/`);
  console.log(`🎮 Contrôle: http://localhost:${PORT}/composition-2`);
  console.log(`📡 API Health: http://localhost:${PORT}/api/health`);
  console.log(`🔧 Test DB: http://localhost:${PORT}/api/test-db`);
  console.log(`✅ Test serveur: http://localhost:${PORT}/test`);
});
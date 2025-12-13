const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 10000;

// ============================================
// CONFIGURATION SUPABASE
// ============================================

const supabaseUrl = process.env.SUPABASE_URL || 'https://glutcejzwmynjxarmldq.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseKey) {
    console.error('❌ ERREUR: SUPABASE_SERVICE_ROLE_KEY manquante dans .env');
    console.error('➡️ Ajoutez-la dans Render: Environment Variables');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// ============================================
// MIDDLEWARE
// ============================================

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '.')));

// ============================================
// MIDDLEWARE D'AUTHENTIFICATION
// ============================================

const authenticateToken = async (req, res, next) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        
        if (!token) {
            return res.status(401).json({ success: false, error: 'Token manquant' });
        }
        
        // Décoder le token (votre système Base64)
        const payload = JSON.parse(Buffer.from(token, 'base64').toString());
        
        // Vérifier l'expiration
        if (payload.exp < Date.now()) {
            return res.status(401).json({ success: false, error: 'Token expiré' });
        }
        
        // Vérifier que l'utilisateur existe et est actif
        let userCheck;
        switch(payload.role) {
            case 'agent':
                userCheck = await supabase
                    .from('agents')
                    .select('id, est_actif, sous_système_id')
                    .eq('id', payload.sub)
                    .single();
                break;
                
            case 'supervisor':
                userCheck = await supabase
                    .from('superviseurs')
                    .select('id, est_actif, sous_système_id, niveau')
                    .eq('id', payload.sub)
                    .single();
                break;
                
            case 'subsystem_admin':
                userCheck = await supabase
                    .from('administrateurs_de_sous_système')
                    .select('id, est_actif, sous_système_id')
                    .eq('id', payload.sub)
                    .single();
                break;
                
            case 'master':
                userCheck = await supabase
                    .from('utilisateurs_maîtres')
                    .select('id, est_actif')
                    .eq('id', payload.sub)
                    .single();
                break;
                
            default:
                return res.status(401).json({ success: false, error: 'Rôle invalide' });
        }
        
        if (userCheck.error || !userCheck.data?.est_actif) {
            return res.status(401).json({ success: false, error: 'Utilisateur inactif ou non trouvé' });
        }
        
        // Ajouter les infos supplémentaires au payload
        req.user = {
            ...payload,
            sous_système_id: userCheck.data.sous_système_id,
            niveau: userCheck.data.niveau
        };
        
        next();
        
    } catch (error) {
        console.error('Erreur authentification:', error);
        res.status(401).json({ success: false, error: 'Token invalide' });
    }
};

const requireRole = (role) => {
    return (req, res, next) => {
        if (req.user.role !== role) {
            return res.status(403).json({ 
                success: false, 
                error: `Accès réservé aux ${role}` 
            });
        }
        next();
    };
};

const requireSupervisorLevel = (level) => {
    return (req, res, next) => {
        if (req.user.role !== 'supervisor' || req.user.niveau !== level) {
            return res.status(403).json({ 
                success: false, 
                error: `Accès réservé aux superviseurs niveau ${level}` 
            });
        }
        next();
    };
};

// ============================================
// ROUTES PUBLIQUES
// ============================================

app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        service: 'Nova Lotto API',
        supabase: 'connected'
    });
});

app.get('/api/system/status', async (req, res) => {
    try {
        const { data, error } = await supabase.from('sous_systèmes').select('count');
        
        if (error) {
            return res.json({ 
                status: 'warning', 
                message: 'Connexion base de données limitée',
                database: 'unavailable'
            });
        }
        
        res.json({ 
            status: 'ok', 
            message: 'Système opérationnel',
            database: 'connected',
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        res.json({ 
            status: 'error', 
            message: 'Erreur système',
            database: 'error'
        });
    }
});

// ============================================
// AUTHENTIFICATION
// ============================================

// Connexion Agent
app.post('/api/agent/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ 
                success: false, 
                error: 'Identifiant et mot de passe requis' 
            });
        }
        
        // Rechercher l'agent
        const { data: agent, error } = await supabase
            .from('agents')
            .select(`
                *,
                sous_systèmes!inner (
                    nom,
                    sous_domaine,
                    est_actif
                )
            `)
            .eq('nom_utilisateur', username)
            .eq('est_actif', true)
            .single();
            
        if (error || !agent) {
            return res.status(401).json({ 
                success: false, 
                error: 'Identifiants incorrects ou compte inactif' 
            });
        }
        
        // Vérifier si le sous-système est actif
        if (!agent.sous_systèmes?.est_actif) {
            return res.status(403).json({ 
                success: false, 
                error: 'Ce sous-système est temporairement désactivé' 
            });
        }
        
        // Vérifier le mot de passe (votre système de hash)
        const passwordHash = Buffer.from(password + 'nova-lotto-salt').toString('base64');
        if (agent.hash_mot_de_passe !== passwordHash) {
            return res.status(401).json({ 
                success: false, 
                error: 'Mot de passe incorrect' 
            });
        }
        
        // Générer le token
        const token = Buffer.from(JSON.stringify({
            sub: agent.id,
            role: 'agent',
            sous_système_id: agent.sous_système_id,
            nom_sous_système: agent.sous_systèmes.nom,
            exp: Date.now() + 86400000 // 24h
        })).toString('base64');
        
        // Mettre à jour la dernière connexion
        await supabase
            .from('agents')
            .update({ dernière_connexion: new Date().toISOString() })
            .eq('id', agent.id);
        
        res.json({
            success: true,
            token: token,
            user: {
                id: agent.id,
                username: agent.nom_utilisateur,
                full_name: agent.nom_complet,
                email: agent.email,
                phone: agent.téléphone,
                role: 'agent',
                sous_système_id: agent.sous_système_id,
                nom_sous_système: agent.sous_systèmes.nom,
                taux_commission: agent.taux_commission,
                limite_billets: agent.limite_billets,
                limite_montant: agent.limite_montant
            }
        });
        
    } catch (error) {
        console.error('Erreur login agent:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Erreur serveur' 
        });
    }
});

// Connexion Superviseur
app.post('/api/supervisor/login', async (req, res) => {
    try {
        const { username, password, level } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ 
                success: false, 
                error: 'Identifiant et mot de passe requis' 
            });
        }
        
        const { data: supervisor, error } = await supabase
            .from('superviseurs')
            .select(`
                *,
                sous_systèmes!inner (
                    nom,
                    sous_domaine,
                    est_actif
                )
            `)
            .eq('nom_utilisateur', username)
            .eq('est_actif', true)
            .single();
            
        if (error || !supervisor) {
            return res.status(401).json({ 
                success: false, 
                error: 'Identifiants incorrects ou compte inactif' 
            });
        }
        
        // Vérifier le niveau si spécifié
        if (level && supervisor.niveau !== parseInt(level)) {
            return res.status(401).json({ 
                success: false, 
                error: 'Niveau de supervision incorrect' 
            });
        }
        
        // Vérifier si le sous-système est actif
        if (!supervisor.sous_systèmes?.est_actif) {
            return res.status(403).json({ 
                success: false, 
                error: 'Ce sous-système est temporairement désactivé' 
            });
        }
        
        // Vérifier le mot de passe
        const passwordHash = Buffer.from(password + 'nova-lotto-salt').toString('base64');
        if (supervisor.hash_mot_de_passe !== passwordHash) {
            return res.status(401).json({ 
                success: false, 
                error: 'Mot de passe incorrect' 
            });
        }
        
        // Générer le token
        const token = Buffer.from(JSON.stringify({
            sub: supervisor.id,
            role: 'supervisor',
            level: supervisor.niveau,
            sous_système_id: supervisor.sous_système_id,
            nom_sous_système: supervisor.sous_systèmes.nom,
            exp: Date.now() + 86400000
        })).toString('base64');
        
        // Mettre à jour la dernière connexion
        await supabase
            .from('superviseurs')
            .update({ dernière_connexion: new Date().toISOString() })
            .eq('id', supervisor.id);
        
        res.json({
            success: true,
            token: token,
            user: {
                id: supervisor.id,
                username: supervisor.nom_utilisateur,
                full_name: supervisor.nom_complet,
                email: supervisor.email,
                phone: supervisor.téléphone,
                role: 'supervisor',
                level: supervisor.niveau,
                sous_système_id: supervisor.sous_système_id,
                nom_sous_système: supervisor.sous_systèmes.nom,
                permissions: supervisor.permissions || []
            }
        });
        
    } catch (error) {
        console.error('Erreur login superviseur:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Erreur serveur' 
        });
    }
});

// Connexion Admin Sous-Système
app.post('/api/subsystem/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ 
                success: false, 
                error: 'Identifiant et mot de passe requis' 
            });
        }
        
        const { data: admin, error } = await supabase
            .from('administrateurs_de_sous_système')
            .select(`
                *,
                sous_systèmes!inner (*)
            `)
            .eq('nom_utilisateur', username)
            .eq('est_actif', true)
            .single();
            
        if (error || !admin) {
            return res.status(401).json({ 
                success: false, 
                error: 'Identifiants incorrects ou compte inactif' 
            });
        }
        
        // Vérifier si le sous-système est actif
        if (!admin.sous_systèmes?.est_actif) {
            return res.status(403).json({ 
                success: false, 
                error: 'Ce sous-système est temporairement désactivé' 
            });
        }
        
        // Vérifier le mot de passe
        const passwordHash = Buffer.from(password + 'nova-lotto-salt').toString('base64');
        if (admin.hash_mot_de_passe !== passwordHash) {
            return res.status(401).json({ 
                success: false, 
                error: 'Mot de passe incorrect' 
            });
        }
        
        // Générer le token
        const token = Buffer.from(JSON.stringify({
            sub: admin.id,
            role: 'subsystem_admin',
            sous_système_id: admin.sous_système_id,
            exp: Date.now() + 86400000
        })).toString('base64');
        
        // Mettre à jour la dernière connexion
        await supabase
            .from('administrateurs_de_sous_système')
            .update({ dernière_connexion: new Date().toISOString() })
            .eq('id', admin.id);
        
        res.json({
            success: true,
            token: token,
            user: {
                id: admin.id,
                username: admin.nom_utilisateur,
                full_name: admin.nom_complet,
                email: admin.email,
                phone: admin.téléphone,
                role: 'subsystem_admin',
                sous_système_id: admin.sous_système_id,
                permissions: admin.permissions || []
            },
            subsystem: admin.sous_systèmes
        });
        
    } catch (error) {
        console.error('Erreur login admin:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Erreur serveur' 
        });
    }
});

// Connexion Master
app.post('/api/master/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ 
                success: false, 
                error: 'Identifiant et mot de passe requis' 
            });
        }
        
        const { data: master, error } = await supabase
            .from('utilisateurs_maîtres')
            .select('*')
            .eq('nom_utilisateur', username)
            .eq('est_actif', true)
            .single();
            
        if (error || !master) {
            return res.status(401).json({ 
                success: false, 
                error: 'Identifiants incorrects ou compte inactif' 
            });
        }
        
        // Vérifier le mot de passe
        const passwordHash = Buffer.from(password + 'nova-lotto-salt').toString('base64');
        if (master.hash_mot_de_passe !== passwordHash) {
            return res.status(401).json({ 
                success: false, 
                error: 'Mot de passe incorrect' 
            });
        }
        
        // Générer le token
        const token = Buffer.from(JSON.stringify({
            sub: master.id,
            role: 'master',
            exp: Date.now() + 86400000
        })).toString('base64');
        
        // Mettre à jour la dernière connexion
        await supabase
            .from('utilisateurs_maîtres')
            .update({ dernière_connexion: new Date().toISOString() })
            .eq('id', master.id);
        
        res.json({
            success: true,
            token: token,
            user: {
                id: master.id,
                username: master.nom_utilisateur,
                full_name: master.nom_complet,
                email: master.email,
                phone: master.téléphone,
                role: 'master',
                permissions: master.permissions || []
            }
        });
        
    } catch (error) {
        console.error('Erreur login master:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Erreur serveur' 
        });
    }
});

// Initialisation Master (première connexion)
app.post('/api/master/init', async (req, res) => {
    try {
        const { masterUsername, masterPassword, companyName, masterEmail } = req.body;
        
        if (!masterUsername || !masterPassword || !masterEmail) {
            return res.status(400).json({ 
                success: false, 
                error: 'Tous les champs sont requis' 
            });
        }
        
        // Vérifier s'il y a déjà un utilisateur master
        const { count } = await supabase
            .from('utilisateurs_maîtres')
            .select('*', { count: 'exact', head: true });
            
        if (count > 0) {
            return res.status(400).json({ 
                success: false, 
                error: 'Le système est déjà initialisé' 
            });
        }
        
        // Créer le premier utilisateur master
        const passwordHash = Buffer.from(masterPassword + 'nova-lotto-salt').toString('base64');
        
        const { data: master, error } = await supabase
            .from('utilisateurs_maîtres')
            .insert({
                nom_utilisateur: masterUsername,
                hash_mot_de_passe: passwordHash,
                nom_complet: companyName || 'Administrateur Master',
                email: masterEmail,
                est_actif: true,
                permissions: JSON.stringify(['full_access'])
            })
            .select()
            .single();
            
        if (error) {
            throw error;
        }
        
        const token = Buffer.from(JSON.stringify({
            sub: master.id,
            role: 'master',
            exp: Date.now() + 86400000
        })).toString('base64');
        
        res.json({
            success: true,
            token: token,
            user: {
                id: master.id,
                username: master.nom_utilisateur,
                full_name: master.nom_complet,
                email: master.email,
                role: 'master'
            }
        });
        
    } catch (error) {
        console.error('Erreur initialisation:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Erreur serveur: ' + error.message 
        });
    }
});

// ============================================
// ROUTES AGENT
// ============================================

// Dashboard agent
app.get('/api/agent/dashboard', authenticateToken, requireRole('agent'), async (req, res) => {
    try {
        const agentId = req.user.sub;
        
        // Utiliser la vue dashboard
        const { data: dashboard, error: dashError } = await supabase
            .from('vue_dashboard_agent')
            .select('*')
            .eq('id', agentId)
            .single();
            
        if (dashError) throw dashError;
        
        // Tickets du jour
        const today = new Date().toISOString().split('T')[0];
        const { data: todayTickets, error: ticketsError } = await supabase
            .from('billets')
            .select('*')
            .eq('agent_id', agentId)
            .gte('crée_le', today + 'T00:00:00')
            .lte('crée_le', today + 'T23:59:59')
            .order('crée_le', { ascending: false });
            
        if (ticketsError) throw ticketsError;
        
        // Statistiques du mois
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);
        
        const { data: monthStats, error: monthError } = await supabase
            .from('statistiques_agent')
            .select('billets_vendus, ventes_total, commission')
            .eq('agent_id', agentId)
            .gte('date', startOfMonth.toISOString().split('T')[0])
            .order('date', { ascending: false });
            
        if (monthError) throw monthError;
        
        const monthlyStats = (monthStats || []).reduce((acc, stat) => ({
            billets: acc.billets + (stat.billets_vendus || 0),
            ventes: acc.ventes + (stat.ventes_total || 0),
            commission: acc.commission + (stat.commission || 0)
        }), { billets: 0, ventes: 0, commission: 0 });
        
        res.json({
            success: true,
            agent: {
                id: dashboard.id,
                full_name: dashboard.nom_complet,
                username: dashboard.nom_utilisateur,
                nom_sous_système: dashboard.nom_sous_système,
                taux_commission: dashboard.taux_commission,
                limite_billets: dashboard.limite_billets,
                limite_montant: dashboard.limite_montant
            },
            stats: {
                aujourdhui: {
                    billets: dashboard.billets_aujourdhui || 0,
                    ventes: dashboard.ventes_aujourdhui || 0,
                    commission: dashboard.commission_aujourdhui || 0
                },
                mois: monthlyStats
            },
            tickets_aujourdhui: todayTickets || []
        });
        
    } catch (error) {
        console.error('Erreur dashboard agent:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Erreur serveur' 
        });
    }
});

// Créer un ticket
app.post('/api/agent/tickets', authenticateToken, requireRole('agent'), async (req, res) => {
    try {
        const agentId = req.user.sub;
        const sousSystèmeId = req.user.sous_système_id;
        
        const { 
            numéro_billet, 
            type_jeu, 
            montant, 
            numéros, 
            date_tirage,
            session_tirage,
            tirage_nom,
            nom_client,
            téléphone_client
        } = req.body;
        
        // Validation
        if (!numéro_billet || !type_jeu || !montant || !numéros) {
            return res.status(400).json({ 
                success: false, 
                error: 'Numéro de ticket, type de jeu, montant et numéros sont requis' 
            });
        }
        
        // Vérifier si le ticket existe déjà
        const { count: existingCount } = await supabase
            .from('billets')
            .select('*', { count: 'exact', head: true })
            .eq('numéro_billet', numéro_billet)
            .eq('sous_système_id', sousSystèmeId);
            
        if (existingCount > 0) {
            return res.status(400).json({ 
                success: false, 
                error: 'Ce numéro de ticket existe déjà' 
            });
        }
        
        // Vérifier les limites de l'agent
        const today = new Date().toISOString().split('T')[0];
        const { data: todayTickets, error: limitError } = await supabase
            .from('billets')
            .select('montant')
            .eq('agent_id', agentId)
            .eq('statut', 'validé')
            .gte('crée_le', today + 'T00:00:00')
            .lte('crée_le', today + 'T23:59:59');
            
        if (limitError) throw limitError;
        
        const todayCount = (todayTickets || []).length;
        const todayAmount = (todayTickets || []).reduce((sum, t) => sum + (t.montant || 0), 0);
        
        // Récupérer les limites de l'agent
        const { data: agent, error: agentError } = await supabase
            .from('agents')
            .select('limite_billets, limite_montant')
            .eq('id', agentId)
            .single();
            
        if (agentError) throw agentError;
        
        if (todayCount >= agent.limite_billets) {
            return res.status(400).json({ 
                success: false, 
                error: `Limite de ${agent.limite_billets} tickets par jour atteinte` 
            });
        }
        
        if (todayAmount + parseFloat(montant) > agent.limite_montant) {
            return res.status(400).json({ 
                success: false, 
                error: `Limite de montant quotidien dépassée` 
            });
        }
        
        // Créer le ticket (le gain est calculé automatiquement par le trigger)
        const { data: ticket, error: ticketError } = await supabase
            .from('billets')
            .insert({
                numéro_billet: numéro_billet,
                type_jeu: type_jeu,
                montant: parseFloat(montant),
                numéros: typeof numéros === 'string' ? numéros : JSON.stringify(numéros),
                date_tirage: date_tirage || new Date().toISOString().split('T')[0],
                session_tirage: session_tirage || 'morning',
                tirage_nom: tirage_nom,
                nom_client: nom_client,
                téléphone_client: téléphone_client,
                agent_id: agentId,
                sous_système_id: sousSystèmeId,
                statut: 'en_attente_de_validation'
            })
            .select()
            .single();
            
        if (ticketError) throw ticketError;
        
        // Créer les détails des paris si fournis
        if (req.body.détails_paris && Array.isArray(req.body.détails_paris)) {
            const détails = req.body.détails_paris.map(détail => ({
                billet_id: ticket.id,
                type_jeu: détail.type_jeu || type_jeu,
                nom_jeu: détail.nom_jeu,
                numéro_joué: détail.numéro_joué,
                montant_mise: détail.montant_mise,
                multiplicateur: détail.multiplicateur
            }));
            
            await supabase
                .from('details_des_paris')
                .insert(détails);
        }
        
        res.json({
            success: true,
            message: 'Ticket créé avec succès',
            ticket: ticket
        });
        
    } catch (error) {
        console.error('Erreur création ticket:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Erreur serveur' 
        });
    }
});

// Liste des tickets de l'agent
app.get('/api/agent/tickets', authenticateToken, requireRole('agent'), async (req, res) => {
    try {
        const agentId = req.user.sub;
        const { 
            page = 1, 
            limit = 20, 
            statut,
            date_début,
            date_fin,
            type_jeu
        } = req.query;
        
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const from = (pageNum - 1) * limitNum;
        
        let query = supabase
            .from('billets')
            .select('*', { count: 'exact' })
            .eq('agent_id', agentId);
            
        // Appliquer les filtres
        if (statut) {
            query = query.eq('statut', statut);
        }
        
        if (type_jeu) {
            query = query.eq('type_jeu', type_jeu);
        }
        
        if (date_début) {
            query = query.gte('crée_le', date_début + 'T00:00:00');
        }
        
        if (date_fin) {
            query = query.lte('crée_le', date_fin + 'T23:59:59');
        }
        
        const { data, error, count } = await query
            .order('crée_le', { ascending: false })
            .range(from, from + limitNum - 1);
            
        if (error) throw error;
        
        // Récupérer les détails pour chaque ticket
        const ticketsAvecDétails = await Promise.all(
            (data || []).map(async (ticket) => {
                const { data: détails } = await supabase
                    .from('details_des_paris')
                    .select('*')
                    .eq('billet_id', ticket.id);
                    
                return {
                    ...ticket,
                    détails: détails || []
                };
            })
        );
        
        res.json({
            success: true,
            billets: ticketsAvecDétails,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total: count,
                total_pages: Math.ceil(count / limitNum)
            }
        });
        
    } catch (error) {
        console.error('Erreur récupération tickets:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Erreur serveur' 
        });
    }
});

// ============================================
// ROUTES SUPERVISEUR NIVEAU 1
// ============================================

// Tickets en attente de validation
app.get('/api/supervisor/level1/pending', authenticateToken, requireSupervisorLevel(1), async (req, res) => {
    try {
        const sousSystèmeId = req.user.sous_système_id;
        
        // Utiliser la vue
        const { data: tickets, error } = await supabase
            .from('vue_tickets_en_attente')
            .select('*')
            .eq('sous_système_id', sousSystèmeId)
            .order('crée_le', { ascending: true });
            
        if (error) throw error;
        
        res.json({
            success: true,
            billets_en_attente: tickets || []
        });
        
    } catch (error) {
        console.error('Erreur tickets en attente:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Erreur serveur' 
        });
    }
});

// Valider un ticket
app.put('/api/supervisor/level1/tickets/:id/validate', authenticateToken, requireSupervisorLevel(1), async (req, res) => {
    try {
        const { id } = req.params;
        const { validated, raison_rejet } = req.body;
        const superviseurId = req.user.sub;
        
        // Vérifier que le ticket existe et est en attente
        const { data: ticket, error: ticketError } = await supabase
            .from('billets')
            .select('sous_système_id, statut, agent_id')
            .eq('id', id)
            .single();
            
        if (ticketError) throw ticketError;
        
        if (ticket.sous_système_id !== req.user.sous_système_id) {
            return res.status(403).json({ 
                success: false, 
                error: 'Ticket non autorisé' 
            });
        }
        
        if (ticket.statut !== 'en_attente_de_validation') {
            return res.status(400).json({ 
                success: false, 
                error: 'Ticket déjà traité' 
            });
        }
        
        // Mettre à jour le ticket
        const updateData = {
            statut: validated ? 'validé' : 'rejeté',
            validé_par: superviseurId,
            validé_le: new Date().toISOString()
        };
        
        if (!validated && raison_rejet) {
            updateData.raison_rejet = raison_rejet;
        }
        
        const { data: updatedTicket, error: updateError } = await supabase
            .from('billets')
            .update(updateData)
            .eq('id', id)
            .select()
            .single();
            
        if (updateError) throw updateError;
        
        res.json({
            success: true,
            message: validated ? 'Ticket validé' : 'Ticket rejeté',
            ticket: updatedTicket
        });
        
    } catch (error) {
        console.error('Erreur validation ticket:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Erreur serveur' 
        });
    }
});

// Statistiques de validation
app.get('/api/supervisor/level1/stats', authenticateToken, requireSupervisorLevel(1), async (req, res) => {
    try {
        const sousSystèmeId = req.user.sous_système_id;
        const today = new Date().toISOString().split('T')[0];
        
        // Tickets validés aujourd'hui
        const { data: validatedToday, error: valError } = await supabase
            .from('billets')
            .select('montant')
            .eq('sous_système_id', sousSystèmeId)
            .eq('statut', 'validé')
            .gte('validé_le', today + 'T00:00:00')
            .lte('validé_le', today + 'T23:59:59');
            
        if (valError) throw valError;
        
        // Tickets rejetés aujourd'hui
        const { data: rejectedToday, error: rejError } = await supabase
            .from('billets')
            .select('montant')
            .eq('sous_système_id', sousSystèmeId)
            .eq('statut', 'rejeté')
            .gte('validé_le', today + 'T00:00:00')
            .lte('validé_le', today + 'T23:59:59');
            
        if (rejError) throw rejError;
        
        // En attente
        const { count: pendingCount } = await supabase
            .from('billets')
            .select('*', { count: 'exact', head: true })
            .eq('sous_système_id', sousSystèmeId)
            .eq('statut', 'en_attente_de_validation');
            
        res.json({
            success: true,
            stats: {
                aujourdhui: {
                    validés: {
                        nombre: validatedToday?.length || 0,
                        montant: (validatedToday || []).reduce((sum, t) => sum + (t.montant || 0), 0)
                    },
                    rejetés: {
                        nombre: rejectedToday?.length || 0,
                        montant: (rejectedToday || []).reduce((sum, t) => sum + (t.montant || 0), 0)
                    }
                },
                nombre_en_attente: pendingCount || 0
            }
        });
        
    } catch (error) {
        console.error('Erreur statistiques superviseur:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Erreur serveur' 
        });
    }
});

// ============================================
// ROUTES SUPERVISEUR NIVEAU 2
// ============================================

// Dashboard superviseur niveau 2
app.get('/api/supervisor/level2/dashboard', authenticateToken, requireSupervisorLevel(2), async (req, res) => {
    try {
        const sousSystèmeId = req.user.sous_système_id;
        
        // Informations du sous-système
        const { data: subsystem, error: subsError } = await supabase
            .from('sous_systèmes')
            .select(`
                *,
                stats:statistiques_du_sous_système(*)
            `)
            .eq('id', sousSystèmeId)
            .single();
            
        if (subsError) throw subsError;
        
        // Agents avec leurs statistiques
        const { data: agents, error: agentsError } = await supabase
            .from('agents')
            .select(`
                id,
                nom_complet,
                nom_utilisateur,
                est_actif,
                taux_commission
            `)
            .eq('sous_système_id', sousSystèmeId);
            
        if (agentsError) throw agentsError;
        
        // Récupérer les statistiques des agents
        const today = new Date().toISOString().split('T')[0];
        const agentsAvecStats = await Promise.all(
            (agents || []).map(async (agent) => {
                const { data: todayStats } = await supabase
                    .from('statistiques_agent')
                    .select('billets_vendus, ventes_total')
                    .eq('agent_id', agent.id)
                    .eq('date', today)
                    .single();
                    
                return {
                    ...agent,
                    stats_aujourdhui: todayStats || { billets_vendus: 0, ventes_total: 0 }
                };
            })
        );
        
        // Tendance des ventes des 7 derniers jours
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        
        const { data: dailySales, error: salesError } = await supabase
            .from('billets')
            .select('crée_le, montant')
            .eq('sous_système_id', sousSystèmeId)
            .eq('statut', 'validé')
            .gte('crée_le', sevenDaysAgo.toISOString())
            .order('crée_le', { ascending: true });
            
        if (salesError) throw salesError;
        
        // Grouper par jour
        const tendance_ventes = {};
        (dailySales || []).forEach(ticket => {
            const date = ticket.crée_le.split('T')[0];
            if (!tendance_ventes[date]) {
                tendance_ventes[date] = 0;
            }
            tendance_ventes[date] += ticket.montant || 0;
        });
        
        res.json({
            success: true,
            sous_système: subsystem,
            agents: agentsAvecStats,
            tendance_ventes: tendance_ventes,
            résumé: {
                total_agents: agents?.length || 0,
                agents_actifs: agentsAvecStats.filter(a => a.est_actif).length,
                total_ventes_aujourdhui: agentsAvecStats.reduce((sum, a) => 
                    sum + (a.stats_aujourdhui.ventes_total || 0), 0
                )
            }
        });
        
    } catch (error) {
        console.error('Erreur dashboard superviseur:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Erreur serveur' 
        });
    }
});

// Liste des agents
app.get('/api/supervisor/level2/agents', authenticateToken, requireSupervisorLevel(2), async (req, res) => {
    try {
        const sousSystèmeId = req.user.sous_système_id;
        
        const { data: agents, error } = await supabase
            .from('agents')
            .select('*')
            .eq('sous_système_id', sousSystèmeId)
            .order('crée_le', { ascending: false });
            
        if (error) throw error;
        
        res.json({
            success: true,
            agents: agents || []
        });
        
    } catch (error) {
        console.error('Erreur récupération agents:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Erreur serveur' 
        });
    }
});

// Créer un agent
app.post('/api/supervisor/level2/agents', authenticateToken, requireSupervisorLevel(2), async (req, res) => {
    try {
        const sousSystèmeId = req.user.sous_système_id;
        
        const { 
            nom_utilisateur, 
            nom_complet, 
            email, 
            téléphone, 
            taux_commission = 0.10,
            limite_billets = 100,
            limite_montant = 100000,
            code_accès
        } = req.body;
        
        if (!nom_utilisateur || !nom_complet) {
            return res.status(400).json({ 
                success: false, 
                error: 'Nom d\'utilisateur et nom complet sont requis' 
            });
        }
        
        // Vérifier si l'utilisateur existe déjà
        const { count: existingCount } = await supabase
            .from('agents')
            .select('*', { count: 'exact', head: true })
            .eq('nom_utilisateur', nom_utilisateur)
            .eq('sous_système_id', sousSystèmeId);
            
        if (existingCount > 0) {
            return res.status(400).json({ 
                success: false, 
                error: 'Ce nom d\'utilisateur existe déjà' 
            });
        }
        
        // Générer un mot de passe temporaire
        const tempPassword = generateRandomPassword(8);
        const passwordHash = Buffer.from(tempPassword + 'nova-lotto-salt').toString('base64');
        
        // Créer l'agent
        const { data: agent, error: agentError } = await supabase
            .from('agents')
            .insert({
                nom_utilisateur: nom_utilisateur,
                hash_mot_de_passe: passwordHash,
                nom_complet: nom_complet,
                email: email,
                téléphone: téléphone,
                code_accès: code_accès || generateRandomCode(6),
                taux_commission: taux_commission,
                limite_billets: limite_billets,
                limite_montant: limite_montant,
                sous_système_id: sousSystèmeId,
                est_actif: true
            })
            .select()
            .single();
            
        if (agentError) throw agentError;
        
        res.json({
            success: true,
            message: 'Agent créé avec succès',
            agent: agent,
            mot_de_passe_temporaire: tempPassword
        });
        
    } catch (error) {
        console.error('Erreur création agent:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Erreur serveur' 
        });
    }
});

// ============================================
// ROUTES ADMIN SOUS-SYSTÈME
// ============================================

// Dashboard admin
app.get('/api/subsystem/dashboard', authenticateToken, requireRole('subsystem_admin'), async (req, res) => {
    try {
        const sousSystèmeId = req.user.sous_système_id;
        
        // Informations du sous-système
        const { data: subsystem, error: subsError } = await supabase
            .from('sous_systèmes')
            .select(`
                *,
                stats:statistiques_du_sous_système(*)
            `)
            .eq('id', sousSystèmeId)
            .single();
            
        if (subsError) throw subsError;
        
        // Statistiques du jour
        const today = new Date().toISOString().split('T')[0];
        const { data: todayTickets } = await supabase
            .from('billets')
            .select('montant, montant_gain')
            .eq('sous_système_id', sousSystèmeId)
            .eq('statut', 'validé')
            .gte('crée_le', today + 'T00:00:00')
            .lte('crée_le', today + 'T23:59:59');
            
        const todaySales = (todayTickets || []).reduce((sum, t) => sum + (t.montant || 0), 0);
        const todayPayout = (todayTickets || []).reduce((sum, t) => sum + (t.montant_gain || 0), 0);
        const todayProfit = todaySales - todayPayout;
        
        // Nombre d'utilisateurs
        const { data: agents } = await supabase
            .from('agents')
            .select('id')
            .eq('sous_système_id', sousSystèmeId)
            .eq('est_actif', true);
            
        const { data: supervisors } = await supabase
            .from('superviseurs')
            .select('id')
            .eq('sous_système_id', sousSystèmeId)
            .eq('est_actif', true);
            
        res.json({
            success: true,
            sous_système: subsystem,
            stats: {
                aujourdhui: {
                    billets: (todayTickets || []).length,
                    ventes: todaySales,
                    gains: todayPayout,
                    profit: todayProfit
                },
                utilisateurs: {
                    agents_actifs: agents?.length || 0,
                    superviseurs_actifs: supervisors?.length || 0
                }
            }
        });
        
    } catch (error) {
        console.error('Erreur dashboard admin:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Erreur serveur' 
        });
    }
});

// ============================================
// ROUTES MASTER
// ============================================

// Liste des sous-systèmes
app.get('/api/master/subsystems', authenticateToken, requireRole('master'), async (req, res) => {
    try {
        const { 
            page = 1, 
            limit = 10, 
            status, 
            search 
        } = req.query;
        
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const from = (pageNum - 1) * limitNum;
        
        let query = supabase
            .from('sous_systèmes')
            .select('*, stats:statistiques_du_sous_système(*)', { count: 'exact' });
            
        if (status === 'active') {
            query = query.eq('est_actif', true);
        } else if (status === 'inactive') {
            query = query.eq('est_actif', false);
        }
        
        if (search) {
            query = query.or(`nom.ilike.%${search}%,sous_domaine.ilike.%${search}%`);
        }
        
        const { data, error, count } = await query
            .order('crée_le', { ascending: false })
            .range(from, from + limitNum - 1);
            
        if (error) throw error;
        
        res.json({
            success: true,
            subsystems: data || [],
            pagination: {
                page: pageNum,
                limit: limitNum,
                total: count,
                total_pages: Math.ceil(count / limitNum)
            }
        });
        
    } catch (error) {
        console.error('Erreur récupération sous-systèmes:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Erreur serveur' 
        });
    }
});

// Créer un sous-système
app.post('/api/master/subsystems', authenticateToken, requireRole('master'), async (req, res) => {
    try {
        const { 
            nom, 
            sous_domaine, 
            email_contact, 
            téléphone_contact, 
            utilisateurs_max = 10, 
            type_abonnement = 'standard',
            subscription_months = 1
        } = req.body;
        
        if (!nom || !sous_domaine || !email_contact) {
            return res.status(400).json({ 
                success: false, 
                error: 'Nom, sous-domaine et email sont requis' 
            });
        }
        
        // Vérifier si le sous-domaine existe déjà
        const { count: existingCount } = await supabase
            .from('sous_systèmes')
            .select('*', { count: 'exact', head: true })
            .eq('sous_domaine', sous_domaine);
            
        if (existingCount > 0) {
            return res.status(400).json({ 
                success: false, 
                error: 'Ce sous-domaine est déjà utilisé' 
            });
        }
        
        // Calculer la date d'expiration
        const subscriptionExpires = new Date();
        subscriptionExpires.setMonth(subscriptionExpires.getMonth() + subscription_months);
        
        // Créer le sous-système
        const { data: subsystem, error: subsystemError } = await supabase
            .from('sous_systèmes')
            .insert({
                nom: nom,
                sous_domaine: sous_domaine,
                email_contact: email_contact,
                téléphone_contact: téléphone_contact,
                utilisateurs_max: utilisateurs_max,
                type_abonnement: type_abonnement,
                abonnement_expire_le: subscriptionExpires.toISOString(),
                est_actif: true
            })
            .select()
            .single();
            
        if (subsystemError) throw subsystemError;
        
        // Créer les statistiques
        await supabase
            .from('statistiques_du_sous_système')
            .insert({
                sous_système_id: subsystem.id,
                utilisateurs_actifs: 0,
                billets_aujourdhui: 0,
                ventes_aujourdhui: 0,
                billets_totaux: 0,
                ventes_totales: 0,
                pourcentage_utilisation: 0
            });
        
        // Créer l'admin du sous-système
        const adminPassword = generateRandomPassword(10);
        const adminPasswordHash = Buffer.from(adminPassword + 'nova-lotto-salt').toString('base64');
        
        await supabase
            .from('administrateurs_de_sous_système')
            .insert({
                nom_utilisateur: sous_domaine + '_admin',
                hash_mot_de_passe: adminPasswordHash,
                nom_complet: `Administrateur ${nom}`,
                email: email_contact,
                sous_système_id: subsystem.id,
                est_actif: true,
                permissions: JSON.stringify(['full_access'])
            });
        
        res.json({
            success: true,
            message: 'Sous-système créé avec succès',
            subsystem: subsystem,
            admin_password: adminPassword
        });
        
    } catch (error) {
        console.error('Erreur création sous-système:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Erreur serveur' 
        });
    }
});

// ============================================
// ROUTES COMMUNES
// ============================================

// Changer le mot de passe
app.post('/api/user/change-password', authenticateToken, async (req, res) => {
    try {
        const { current_password, new_password } = req.body;
        const userId = req.user.sub;
        const userRole = req.user.role;
        
        if (!current_password || !new_password) {
            return res.status(400).json({ 
                success: false, 
                error: 'Mot de passe actuel et nouveau mot de passe requis' 
            });
        }
        
        if (new_password.length < 8) {
            return res.status(400).json({ 
                success: false, 
                error: 'Le nouveau mot de passe doit faire au moins 8 caractères' 
            });
        }
        
        // Trouver la table
        let tableName;
        switch(userRole) {
            case 'agent':
                tableName = 'agents';
                break;
            case 'supervisor':
                tableName = 'superviseurs';
                break;
            case 'subsystem_admin':
                tableName = 'administrateurs_de_sous_système';
                break;
            case 'master':
                tableName = 'utilisateurs_maîtres';
                break;
            default:
                return res.status(400).json({ 
                    success: false, 
                    error: 'Rôle invalide' 
                });
        }
        
        // Vérifier le mot de passe actuel
        const { data: user, error: userError } = await supabase
            .from(tableName)
            .select('hash_mot_de_passe')
            .eq('id', userId)
            .single();
            
        if (userError) throw userError;
        
        const currentHash = Buffer.from(current_password + 'nova-lotto-salt').toString('base64');
        if (user.hash_mot_de_passe !== currentHash) {
            return res.status(401).json({ 
                success: false, 
                error: 'Mot de passe actuel incorrect' 
            });
        }
        
        // Mettre à jour
        const newHash = Buffer.from(new_password + 'nova-lotto-salt').toString('base64');
        
        await supabase
            .from(tableName)
            .update({ 
                hash_mot_de_passe: newHash,
                mis_à_jour_le: new Date().toISOString()
            })
            .eq('id', userId);
        
        res.json({
            success: true,
            message: 'Mot de passe changé avec succès'
        });
        
    } catch (error) {
        console.error('Erreur changement mot de passe:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Erreur serveur' 
        });
    }
});

// Profil utilisateur
app.get('/api/user/profile', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.sub;
        const userRole = req.user.role;
        
        let tableName;
        let selectFields = '*';
        
        switch(userRole) {
            case 'agent':
                tableName = 'agents';
                selectFields = '*, sous_systèmes(nom, sous_domaine)';
                break;
            case 'supervisor':
                tableName = 'superviseurs';
                selectFields = '*, sous_systèmes(nom, sous_domaine)';
                break;
            case 'subsystem_admin':
                tableName = 'administrateurs_de_sous_système';
                selectFields = '*, sous_systèmes(nom, sous_domaine)';
                break;
            case 'master':
                tableName = 'utilisateurs_maîtres';
                break;
            default:
                return res.status(400).json({ 
                    success: false, 
                    error: 'Rôle invalide' 
                });
        }
        
        const { data: user, error } = await supabase
            .from(tableName)
            .select(selectFields)
            .eq('id', userId)
            .single();
            
        if (error) throw error;
        
        // Masquer le hash
        const { hash_mot_de_passe, ...safeUser } = user;
        
        res.json({
            success: true,
            profile: safeUser
        });
        
    } catch (error) {
        console.error('Erreur récupération profil:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Erreur serveur' 
        });
    }
});

// ============================================
// FONCTIONS UTILITAIRES
// ============================================

function generateRandomPassword(length = 10) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
    let password = '';
    for (let i = 0; i < length; i++) {
        password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
}

function generateRandomCode(length = 6) {
    const chars = '0123456789';
    let code = '';
    for (let i = 0; i < length; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

// ============================================
// SERVIR LES FICHIERS STATIQUES
// ============================================

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/agent', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/supervisor-level1', (req, res) => {
    res.sendFile(path.join(__dirname, 'control-level1.html'));
});

app.get('/supervisor-level2', (req, res) => {
    res.sendFile(path.join(__dirname, 'control-level2.html'));
});

app.get('/master', (req, res) => {
    res.sendFile(path.join(__dirname, 'master-dashboard.html'));
});

// ============================================
// DÉMARRAGE DU SERVEUR
// ============================================

app.listen(PORT, () => {
    console.log(`🚀 Serveur Nova Lotto démarré sur le port ${PORT}`);
    console.log(`📊 Supabase connecté: ${supabaseUrl}`);
    console.log(`🌐 URLs:`);
    console.log(`   • Login: http://localhost:${PORT}/`);
    console.log(`   • Agent: http://localhost:${PORT}/agent`);
    console.log(`   • Superviseur N1: http://localhost:${PORT}/supervisor-level1`);
    console.log(`   • Superviseur N2: http://localhost:${PORT}/supervisor-level2`);
    console.log(`   • Master: http://localhost:${PORT}/master`);
});
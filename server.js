const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration Supabase
const supabaseUrl = process.env.SUPABASE_URL || 'https://glutcejzwmynjxarmldq.supabase.co';
const supabaseKey = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdsdXRjZWp6d215bmp4YXJtbGRxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU1MTAzNzIsImV4cCI6MjA4MTA4NjM3Mn0.vkQ4ykvO0B1IyVk668kUBfkHduikEFcLJdkzayzyOwA';
const supabase = createClient(supabaseUrl, supabaseKey);

// Middleware
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
        
        // Décoder le token
        const payload = JSON.parse(Buffer.from(token, 'base64').toString());
        
        // Vérifier l'expiration
        if (payload.exp < Date.now()) {
            return res.status(401).json({ success: false, error: 'Token expiré' });
        }
        
        req.user = payload;
        next();
        
    } catch (error) {
        res.status(401).json({ success: false, error: 'Token invalide' });
    }
};

const requireRole = (role) => {
    return (req, res, next) => {
        if (req.user.role !== role) {
            return res.status(403).json({ 
                success: false, 
                error: `Accès réservé aux ${role}s` 
            });
        }
        next();
    };
};

const requireSupervisorLevel = (level) => {
    return (req, res, next) => {
        if (req.user.role !== 'supervisor' || req.user.level !== level) {
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

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        service: 'Nova Lotto API'
    });
});

// Vérification système
app.get('/api/system/status', async (req, res) => {
    try {
        // Vérifier la connexion à Supabase
        const { data, error } = await supabase.from('utilisateurs_maîtres').select('count');
        
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
        
        const { data, error } = await supabase
            .from('agents')
            .select('*, sous_systèmes(nom, sous_domaine, est_actif)')
            .eq('nom_utilisateur', username)
            .eq('est_actif', true)
            .single();
            
        if (error || !data) {
            return res.status(401).json({ 
                success: false, 
                error: 'Identifiants incorrects ou compte inactif' 
            });
        }
        
        // Vérifier si le sous-système est actif
        if (!data.sous_systèmes?.est_actif) {
            return res.status(403).json({ 
                success: false, 
                error: 'Ce sous-système est temporairement désactivé' 
            });
        }
        
        // Vérifier le mot de passe
        const passwordHash = Buffer.from(password + 'nova-lotto-salt').toString('base64');
        if (data.hash_mot_de_passe !== passwordHash) {
            return res.status(401).json({ 
                success: false, 
                error: 'Mot de passe incorrect' 
            });
        }
        
        // Générer le token
        const token = Buffer.from(JSON.stringify({
            sub: data.id,
            role: 'agent',
            sous_système_id: data.sous_système_id,
            nom_sous_système: data.sous_systèmes?.nom,
            exp: Date.now() + 86400000 // 24h
        })).toString('base64');
        
        res.json({
            success: true,
            token: token,
            user: {
                id: data.id,
                username: data.nom_utilisateur,
                full_name: data.nom_complet,
                email: data.email,
                phone: data.téléphone,
                role: 'agent',
                sous_système_id: data.sous_système_id,
                nom_sous_système: data.sous_systèmes?.nom,
                sous_domaine: data.sous_systèmes?.sous_domaine,
                taux_commission: data.taux_commission,
                limite_billets: data.limite_billets
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
        
        const { data, error } = await supabase
            .from('superviseurs')
            .select('*, sous_systèmes(nom, sous_domaine, est_actif)')
            .eq('nom_utilisateur', username)
            .eq('est_actif', true)
            .single();
            
        if (error || !data) {
            return res.status(401).json({ 
                success: false, 
                error: 'Identifiants incorrects ou compte inactif' 
            });
        }
        
        // Vérifier le niveau si spécifié
        if (level && data.niveau !== parseInt(level)) {
            return res.status(401).json({ 
                success: false, 
                error: 'Niveau de supervision incorrect' 
            });
        }
        
        // Vérifier si le sous-système est actif
        if (!data.sous_systèmes?.est_actif) {
            return res.status(403).json({ 
                success: false, 
                error: 'Ce sous-système est temporairement désactivé' 
            });
        }
        
        // Vérifier le mot de passe
        const passwordHash = Buffer.from(password + 'nova-lotto-salt').toString('base64');
        if (data.hash_mot_de_passe !== passwordHash) {
            return res.status(401).json({ 
                success: false, 
                error: 'Mot de passe incorrect' 
            });
        }
        
        // Générer le token
        const token = Buffer.from(JSON.stringify({
            sub: data.id,
            role: 'supervisor',
            level: data.niveau,
            sous_système_id: data.sous_système_id,
            nom_sous_système: data.sous_systèmes?.nom,
            exp: Date.now() + 86400000
        })).toString('base64');
        
        res.json({
            success: true,
            token: token,
            user: {
                id: data.id,
                username: data.nom_utilisateur,
                full_name: data.nom_complet,
                email: data.email,
                phone: data.téléphone,
                role: 'supervisor',
                level: data.niveau,
                sous_système_id: data.sous_système_id,
                nom_sous_système: data.sous_systèmes?.nom,
                sous_domaine: data.sous_systèmes?.sous_domaine,
                permissions: data.permissions || []
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
        
        const { data, error } = await supabase
            .from('administrateurs_de_sous_système')
            .select('*, sous_systèmes(*, stats:statistiques_du_sous_système(*))')
            .eq('nom_utilisateur', username)
            .eq('est_actif', true)
            .single();
            
        if (error || !data) {
            return res.status(401).json({ 
                success: false, 
                error: 'Identifiants incorrects ou compte inactif' 
            });
        }
        
        // Vérifier si le sous-système est actif
        if (!data.sous_systèmes?.est_actif) {
            return res.status(403).json({ 
                success: false, 
                error: 'Ce sous-système est temporairement désactivé' 
            });
        }
        
        // Vérifier le mot de passe
        const passwordHash = Buffer.from(password + 'nova-lotto-salt').toString('base64');
        if (data.hash_mot_de_passe !== passwordHash) {
            return res.status(401).json({ 
                success: false, 
                error: 'Mot de passe incorrect' 
            });
        }
        
        // Générer le token
        const token = Buffer.from(JSON.stringify({
            sub: data.id,
            role: 'subsystem_admin',
            sous_système_id: data.sous_système_id,
            exp: Date.now() + 86400000
        })).toString('base64');
        
        res.json({
            success: true,
            token: token,
            user: {
                id: data.id,
                username: data.nom_utilisateur,
                full_name: data.nom_complet,
                email: data.email,
                phone: data.téléphone,
                role: 'subsystem_admin',
                sous_système_id: data.sous_système_id,
                permissions: data.permissions || []
            },
            subsystem: {
                id: data.sous_systèmes.id,
                name: data.sous_systèmes.nom,
                subdomain: data.sous_systèmes.sous_domaine,
                contact_email: data.sous_systèmes.email_contact,
                contact_phone: data.sous_systèmes.téléphone_contact,
                max_users: data.sous_systèmes.utilisateurs_max,
                subscription_type: data.sous_systèmes.type_abonnement,
                subscription_expires: data.sous_systèmes.abonnement_expire_le,
                is_active: data.sous_systèmes.est_actif,
                stats: data.sous_systèmes.stats
            }
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
        
        const { data, error } = await supabase
            .from('utilisateurs_maîtres')
            .select('*')
            .eq('nom_utilisateur', username)
            .eq('est_actif', true)
            .single();
            
        if (error || !data) {
            return res.status(401).json({ 
                success: false, 
                error: 'Identifiants incorrects ou compte inactif' 
            });
        }
        
        // Vérifier le mot de passe
        const passwordHash = Buffer.from(password + 'nova-lotto-salt').toString('base64');
        if (data.hash_mot_de_passe !== passwordHash) {
            return res.status(401).json({ 
                success: false, 
                error: 'Mot de passe incorrect' 
            });
        }
        
        // Générer le token
        const token = Buffer.from(JSON.stringify({
            sub: data.id,
            role: 'master',
            exp: Date.now() + 86400000
        })).toString('base64');
        
        res.json({
            success: true,
            token: token,
            user: {
                id: data.id,
                username: data.nom_utilisateur,
                full_name: data.nom_complet,
                email: data.email,
                phone: data.téléphone,
                role: 'master',
                permissions: data.permissions || []
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
        
        const { data, error } = await supabase
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
            sub: data.id,
            role: 'master',
            exp: Date.now() + 86400000
        })).toString('base64');
        
        res.json({
            success: true,
            token: token,
            user: {
                id: data.id,
                username: data.nom_utilisateur,
                full_name: data.nom_complet,
                email: data.email,
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
// ROUTES MASTER (ADMINISTRATION GLOBALE)
// ============================================

// Obtenir tous les sous-systèmes (avec pagination)
app.get('/api/master/subsystems', authenticateToken, requireRole('master'), async (req, res) => {
    try {
        const { 
            page = 1, 
            limit = 10, 
            status, 
            search,
            sort_by = 'crée_le',
            sort_order = 'desc'
        } = req.query;
        
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const from = (pageNum - 1) * limitNum;
        
        let query = supabase
            .from('sous_systèmes')
            .select('*, stats:statistiques_du_sous_système(*)', { count: 'exact' });
            
        // Appliquer les filtres
        if (status === 'active') {
            query = query.eq('est_actif', true);
        } else if (status === 'inactive') {
            query = query.eq('est_actif', false);
        } else if (status === 'expired') {
            query = query.lt('abonnement_expire_le', new Date().toISOString());
        }
        
        if (search) {
            query = query.or(`nom.ilike.%${search}%,sous_domaine.ilike.%${search}%,email_contact.ilike.%${search}%`);
        }
        
        // Appliquer le tri
        if (sort_order === 'asc') {
            query = query.order(sort_by, { ascending: true });
        } else {
            query = query.order(sort_by, { ascending: false });
        }
        
        const { data, error, count } = await query
            .range(from, from + limitNum - 1);
            
        if (error) throw error;
        
        // Calculer les jours restants pour chaque sous-système
        const subsystemsWithDetails = (data || []).map(subsystem => {
            let daysLeft = null;
            let subscriptionStatus = 'active';
            
            if (subsystem.abonnement_expire_le) {
                const expireDate = new Date(subsystem.abonnement_expire_le);
                const now = new Date();
                daysLeft = Math.ceil((expireDate - now) / (1000 * 60 * 60 * 24));
                
                if (daysLeft <= 0) {
                    subscriptionStatus = 'expired';
                } else if (daysLeft <= 7) {
                    subscriptionStatus = 'expiring_soon';
                }
            }
            
            return {
                ...subsystem,
                subscription_days_left: daysLeft,
                subscription_status: subscriptionStatus
            };
        });
        
        res.json({
            success: true,
            subsystems: subsystemsWithDetails,
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

// Statistiques du dashboard master
app.get('/api/master/dashboard/stats', authenticateToken, requireRole('master'), async (req, res) => {
    try {
        // Compter les sous-systèmes actifs
        const { count: totalSubsystems, error: countError } = await supabase
            .from('sous_systèmes')
            .select('*', { count: 'exact', head: true });
            
        const { count: activeSubsystems } = await supabase
            .from('sous_systèmes')
            .select('*', { count: 'exact', head: true })
            .eq('est_actif', true);
            
        // Compter tous les utilisateurs
        const { count: totalAgents } = await supabase
            .from('agents')
            .select('*', { count: 'exact', head: true })
            .eq('est_actif', true);
            
        const { count: totalSupervisors } = await supabase
            .from('superviseurs')
            .select('*', { count: 'exact', head: true })
            .eq('est_actif', true);
            
        const { count: totalAdmins } = await supabase
            .from('administrateurs_de_sous_système')
            .select('*', { count: 'exact', head: true })
            .eq('est_actif', true);
            
        const totalUsers = (totalAgents || 0) + (totalSupervisors || 0) + (totalAdmins || 0);
        
        // Revenu estimé
        const { data: subsystems } = await supabase
            .from('sous_systèmes')
            .select('type_abonnement, crée_le, est_actif');
            
        const monthlyRevenue = subsystems?.reduce((sum, sys) => {
            if (!sys.est_actif) return sum;
            
            const basePrice = {
                basic: 3000,
                standard: 5000,
                premium: 8000,
                enterprise: 15000
            }[sys.type_abonnement] || 3000;
            
            return sum + basePrice;
        }, 0) || 0;
        
        // Sous-systèmes expirant bientôt
        const { count: expiringSoon } = await supabase
            .from('sous_systèmes')
            .select('*', { count: 'exact', head: true })
            .lt('abonnement_expire_le', new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString())
            .gt('abonnement_expire_le', new Date().toISOString());
            
        // Tickets aujourd'hui (estimation)
        const { count: todayTickets } = await supabase
            .from('billets')
            .select('*', { count: 'exact', head: true })
            .gte('crée_le', new Date().toISOString().split('T')[0]);
            
        res.json({
            success: true,
            stats: {
                total_subsystems: totalSubsystems || 0,
                active_subsystems: activeSubsystems || 0,
                total_users: totalUsers,
                monthly_revenue: monthlyRevenue,
                expiring_soon: expiringSoon || 0,
                today_tickets: todayTickets || 0,
                active_rate: activeSubsystems > 0 ? Math.round((activeSubsystems / totalSubsystems) * 100) : 0
            }
        });
        
    } catch (error) {
        console.error('Erreur statistiques dashboard:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Erreur serveur' 
        });
    }
});

// Créer un nouveau sous-système
app.post('/api/master/subsystems', authenticateToken, requireRole('master'), async (req, res) => {
    try {
        const { 
            nom, 
            sous_domaine, 
            email_contact, 
            téléphone_contact, 
            utilisateurs_max = 10, 
            type_abonnement = 'standard', 
            subscription_months = 1,
            send_credentials = true
        } = req.body;
        
        // Validation
        if (!nom || !sous_domaine || !email_contact) {
            return res.status(400).json({ 
                success: false, 
                error: 'Nom, sous-domaine et email sont requis' 
            });
        }
        
        // Vérifier le format du sous-domaine
        if (!/^[a-z0-9-]+$/.test(sous_domaine)) {
            return res.status(400).json({ 
                success: false, 
                error: 'Le sous-domaine ne peut contenir que des lettres minuscules, chiffres et tirets' 
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
            
        if (subsystemError) {
            console.error('Erreur création sous-système:', subsystemError);
            return res.status(500).json({ 
                success: false, 
                error: 'Erreur création sous-système' 
            });
        }
        
        // Générer les identifiants admin
        const adminUsername = sous_domaine + '_admin';
        const adminPassword = generateRandomPassword(10);
        const adminPasswordHash = Buffer.from(adminPassword + 'nova-lotto-salt').toString('base64');
        
        // Créer l'admin du sous-système
        const { data: admin, error: adminError } = await supabase
            .from('administrateurs_de_sous_système')
            .insert({
                nom_utilisateur: adminUsername,
                hash_mot_de_passe: adminPasswordHash,
                nom_complet: `Administrateur ${nom}`,
                email: email_contact,
                téléphone: téléphone_contact,
                sous_système_id: subsystem.id,
                est_actif: true,
                permissions: JSON.stringify(['full_access'])
            })
            .select()
            .single();
            
        if (adminError) {
            // Rollback: supprimer le sous-système
            await supabase.from('sous_systèmes').delete().eq('id', subsystem.id);
            console.error('Erreur création admin:', adminError);
            return res.status(500).json({ 
                success: false, 
                error: 'Erreur création administrateur' 
            });
        }
        
        // Créer les statistiques initiales
        await supabase
            .from('statistiques_du_sous_système')
            .insert({
                sous_système_id: subsystem.id,
                utilisateurs_actifs: 1,
                billets_aujourdhui: 0,
                ventes_aujourdhui: 0,
                billets_totaux: 0,
                ventes_totales: 0,
                pourcentage_utilisation: Math.round((1 / utilisateurs_max) * 100)
            });
        
        // URL d'accès
        const host = req.get('host');
        const protocol = req.protocol;
        const accessUrl = `${protocol}://${sous_domaine}.${host.replace('master.', '') || 'novalotto.com'}`;
        
        res.json({
            success: true,
            message: 'Sous-système créé avec succès',
            subsystem: subsystem,
            admin_credentials: {
                username: adminUsername,
                password: adminPassword,
                email: email_contact,
                access_url: accessUrl
            }
        });
        
    } catch (error) {
        console.error('Erreur création sous-système:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Erreur serveur: ' + error.message 
        });
    }
});

// Détails d'un sous-système
app.get('/api/master/subsystems/:id', authenticateToken, requireRole('master'), async (req, res) => {
    try {
        const { id } = req.params;
        
        const { data, error } = await supabase
            .from('sous_systèmes')
            .select(`
                *,
                stats:statistiques_du_sous_système(*),
                admins:administrateurs_de_sous_système(count),
                agents:agents(count),
                superviseurs:superviseurs(count),
                recent_tickets:billets(count)
            `)
            .eq('id', id)
            .single();
            
        if (error) {
            if (error.code === 'PGRST116') {
                return res.status(404).json({ 
                    success: false, 
                    error: 'Sous-système non trouvé' 
                });
            }
            throw error;
        }
        
        // Calculer les jours restants
        let daysLeft = null;
        if (data.abonnement_expire_le) {
            const expireDate = new Date(data.abonnement_expire_le);
            const now = new Date();
            daysLeft = Math.ceil((expireDate - now) / (1000 * 60 * 60 * 24));
        }
        
        res.json({
            success: true,
            subsystem: {
                ...data,
                subscription_days_left: daysLeft
            }
        });
        
    } catch (error) {
        console.error('Erreur récupération détails:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Erreur serveur' 
        });
    }
});

// Désactiver un sous-système
app.put('/api/master/subsystems/:id/deactivate', authenticateToken, requireRole('master'), async (req, res) => {
    try {
        const { id } = req.params;
        
        const { data, error } = await supabase
            .from('sous_systèmes')
            .update({ 
                est_actif: false,
                désactivé_le: new Date().toISOString()
            })
            .eq('id', id)
            .select()
            .single();
            
        if (error) throw error;
        
        res.json({
            success: true,
            message: 'Sous-système désactivé avec succès',
            subsystem: data
        });
        
    } catch (error) {
        console.error('Erreur désactivation:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Erreur serveur' 
        });
    }
});

// Activer un sous-système
app.put('/api/master/subsystems/:id/activate', authenticateToken, requireRole('master'), async (req, res) => {
    try {
        const { id } = req.params;
        
        const { data, error } = await supabase
            .from('sous_systèmes')
            .update({ 
                est_actif: true,
                désactivé_le: null
            })
            .eq('id', id)
            .select()
            .single();
            
        if (error) throw error;
        
        res.json({
            success: true,
            message: 'Sous-système activé avec succès',
            subsystem: data
        });
        
    } catch (error) {
        console.error('Erreur activation:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Erreur serveur' 
        });
    }
});

// Renouveler l'abonnement d'un sous-système
app.put('/api/master/subsystems/:id/renew', authenticateToken, requireRole('master'), async (req, res) => {
    try {
        const { id } = req.params;
        const { months = 1 } = req.body;
        
        // Récupérer le sous-système
        const { data: subsystem, error: fetchError } = await supabase
            .from('sous_systèmes')
            .select('abonnement_expire_le')
            .eq('id', id)
            .single();
            
        if (fetchError) throw fetchError;
        
        // Calculer la nouvelle date d'expiration
        let newExpiryDate;
        if (subsystem.abonnement_expire_le) {
            newExpiryDate = new Date(subsystem.abonnement_expire_le);
        } else {
            newExpiryDate = new Date();
        }
        
        newExpiryDate.setMonth(newExpiryDate.getMonth() + months);
        
        // Mettre à jour
        const { data, error } = await supabase
            .from('sous_systèmes')
            .update({ 
                abonnement_expire_le: newExpiryDate.toISOString(),
                est_actif: true
            })
            .eq('id', id)
            .select()
            .single();
            
        if (error) throw error;
        
        res.json({
            success: true,
            message: `Abonnement renouvelé pour ${months} mois`,
            subsystem: data
        });
        
    } catch (error) {
        console.error('Erreur renouvellement:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Erreur serveur' 
        });
    }
});

// Rapport consolidé
app.get('/api/master/consolidated-report', authenticateToken, requireRole('master'), async (req, res) => {
    try {
        const { 
            start_date = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], 
            end_date = new Date().toISOString().split('T')[0],
            group_by = 'day' 
        } = req.query;
        
        // Récupérer tous les sous-systèmes actifs
        const { data: subsystems, error: subsError } = await supabase
            .from('sous_systèmes')
            .select('id, nom, sous_domaine, type_abonnement')
            .eq('est_actif', true);
            
        if (subsError) throw subsError;
        
        // Pour chaque sous-système, récupérer les statistiques
        const subsystemsDetail = [];
        let totalTickets = 0;
        let totalSales = 0;
        let totalPayout = 0;
        
        for (const subsystem of subsystems) {
            // Récupérer les tickets du sous-système pour la période
            const { data: tickets, error: ticketsError } = await supabase
                .from('billets')
                .select('montant, montant_gain')
                .eq('sous_système_id', subsystem.id)
                .gte('crée_le', start_date)
                .lte('crée_le', end_date + 'T23:59:59');
                
            if (ticketsError) throw ticketsError;
            
            const subsystemTickets = tickets || [];
            const subsystemSales = subsystemTickets.reduce((sum, t) => sum + (t.montant || 0), 0);
            const subsystemPayout = subsystemTickets.reduce((sum, t) => sum + (t.montant_gain || 0), 0);
            const subsystemProfit = subsystemSales - subsystemPayout;
            
            subsystemsDetail.push({
                sous_système_id: subsystem.id,
                nom_sous_système: subsystem.nom,
                sous_domaine: subsystem.sous_domaine,
                nombre_billets: subsystemTickets.length,
                ventes_totales: subsystemSales,
                gains_totaux: subsystemPayout,
                profit: subsystemProfit
            });
            
            totalTickets += subsystemTickets.length;
            totalSales += subsystemSales;
            totalPayout += subsystemPayout;
        }
        
        // Générer le breakdown quotidien
        const dailyBreakdown = [];
        const start = new Date(start_date);
        const end = new Date(end_date);
        
        for (let date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
            const dateStr = date.toISOString().split('T')[0];
            
            // Récupérer les tickets pour ce jour
            const { data: dailyTickets, error: dailyError } = await supabase
                .from('billets')
                .select('montant')
                .gte('crée_le', dateStr + 'T00:00:00')
                .lte('crée_le', dateStr + 'T23:59:59');
                
            if (dailyError) throw dailyError;
            
            const dailySales = (dailyTickets || []).reduce((sum, t) => sum + (t.montant || 0), 0);
            
            dailyBreakdown.push({
                date: dateStr,
                nombre_billets: (dailyTickets || []).length,
                montant_total: dailySales,
                montant_moyen_billet: (dailyTickets || []).length > 0 ? 
                    dailySales / (dailyTickets || []).length : 0
            });
        }
        
        res.json({
            success: true,
            report: {
                période: { 
                    date_début: start_date, 
                    date_fin: end_date 
                },
                total_sous_systèmes: subsystems?.length || 0,
                résumé: {
                    total_billets: totalTickets,
                    total_ventes: totalSales,
                    total_gains: totalPayout,
                    total_profit: totalSales - totalPayout,
                    ventes_moyennes_quotidiennes: totalSales / Math.max(1, dailyBreakdown.length),
                    montant_moyen_billet: totalTickets > 0 ? totalSales / totalTickets : 0
                },
                détail_sous_systèmes: subsystemsDetail,
                répartition_quotidienne: dailyBreakdown
            }
        });
        
    } catch (error) {
        console.error('Erreur génération rapport:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Erreur serveur' 
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
        const sousSystèmeId = req.user.sous_système_id;
        
        // Récupérer les informations de l'agent
        const { data: agent, error: agentError } = await supabase
            .from('agents')
            .select('*, sous_systèmes(nom, sous_domaine)')
            .eq('id', agentId)
            .single();
            
        if (agentError) throw agentError;
        
        // Statistiques du jour
        const today = new Date().toISOString().split('T')[0];
        
        const { data: todayTickets, error: ticketsError } = await supabase
            .from('billets')
            .select('montant, montant_gain, statut')
            .eq('agent_id', agentId)
            .gte('crée_le', today + 'T00:00:00')
            .lte('crée_le', today + 'T23:59:59');
            
        if (ticketsError) throw ticketsError;
        
        const todaySales = (todayTickets || []).reduce((sum, t) => sum + (t.montant || 0), 0);
        const todayPayout = (todayTickets || []).reduce((sum, t) => sum + (t.montant_gain || 0), 0);
        const todayProfit = todaySales - todayPayout;
        
        // Tickets en attente de validation
        const { data: pendingTickets, error: pendingError } = await supabase
            .from('billets')
            .select('count')
            .eq('agent_id', agentId)
            .eq('statut', 'en_attente_de_validation');
            
        if (pendingError) throw pendingError;
        
        // Performances des 7 derniers jours
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        
        const { data: weeklyStats, error: weeklyError } = await supabase
            .from('billets')
            .select('crée_le, montant, montant_gain')
            .eq('agent_id', agentId)
            .gte('crée_le', sevenDaysAgo.toISOString())
            .order('crée_le', { ascending: true });
            
        if (weeklyError) throw weeklyError;
        
        // Grouper par jour
        const dailyStats = {};
        (weeklyStats || []).forEach(ticket => {
            const date = ticket.crée_le.split('T')[0];
            if (!dailyStats[date]) {
                dailyStats[date] = { ventes: 0, gains: 0, nombre: 0 };
            }
            dailyStats[date].ventes += ticket.montant || 0;
            dailyStats[date].gains += ticket.montant_gain || 0;
            dailyStats[date].nombre += 1;
        });
        
        res.json({
            success: true,
            agent: {
                id: agent.id,
                username: agent.nom_utilisateur,
                full_name: agent.nom_complet,
                email: agent.email,
                phone: agent.téléphone,
                taux_commission: agent.taux_commission,
                limite_billets: agent.limite_billets,
                nom_sous_système: agent.sous_systèmes?.nom
            },
            stats: {
                aujourdhui: {
                    nombre_billets: (todayTickets || []).length,
                    ventes: todaySales,
                    gains: todayPayout,
                    profit: todayProfit,
                    commission: todayProfit * (agent.taux_commission || 0.1)
                },
                en_attente_de_validation: pendingTickets?.[0]?.count || 0,
                stats_quotidiennes: dailyStats
            }
        });
        
    } catch (error) {
        console.error('Erreur dashboard agent:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Erreur serveur' 
        });
    }
});

// Créer un nouveau ticket
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
        
        // Calculer le gain selon le type de jeu
        const montantGain = calculatePayout(type_jeu, montant);
        
        // Créer le ticket
        const { data: ticket, error: ticketError } = await supabase
            .from('billets')
            .insert({
                numéro_billet: numéro_billet,
                type_jeu: type_jeu,
                montant: parseFloat(montant),
                montant_gain: montantGain,
                numéros: numéros,
                date_tirage: date_tirage || new Date().toISOString().split('T')[0],
                nom_client: nom_client,
                téléphone_client: téléphone_client,
                agent_id: agentId,
                sous_système_id: sousSystèmeId,
                statut: 'en_attente_de_validation'
            })
            .select()
            .single();
            
        if (ticketError) throw ticketError;
        
        // Mettre à jour les statistiques du sous-système
        await updateSubsystemStats(sousSystèmeId, parseFloat(montant));
        
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
        
        // Calculer les totaux
        const totals = (data || []).reduce((acc, ticket) => {
            acc.total_montant += ticket.montant || 0;
            acc.total_gains += ticket.montant_gain || 0;
            acc.total_profit += (ticket.montant || 0) - (ticket.montant_gain || 0);
            return acc;
        }, { total_montant: 0, total_gains: 0, total_profit: 0 });
        
        res.json({
            success: true,
            billets: data || [],
            totaux: totals,
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
        
        const { data: tickets, error } = await supabase
            .from('billets')
            .select(`
                *,
                agents(nom_complet, nom_utilisateur)
            `)
            .eq('sous_système_id', sousSystèmeId)
            .eq('statut', 'en_attente_de_validation')
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
        
        // Vérifier que le ticket appartient au sous-système du superviseur
        const { data: ticket, error: ticketError } = await supabase
            .from('billets')
            .select('sous_système_id, statut')
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
            
        // Performances par agent
        const { data: agentPerformance, error: perfError } = await supabase
            .from('billets')
            .select(`
                agent_id,
                agents(nom_complet),
                statut,
                montant
            `)
            .eq('sous_système_id', sousSystèmeId)
            .gte('crée_le', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());
            
        if (perfError) throw perfError;
        
        // Grouper par agent
        const agentsMap = {};
        (agentPerformance || []).forEach(ticket => {
            const agentId = ticket.agent_id;
            if (!agentsMap[agentId]) {
                agentsMap[agentId] = {
                    nom_agent: ticket.agents?.nom_complet || 'Inconnu',
                    total_billets: 0,
                    validés: 0,
                    rejetés: 0,
                    en_attente: 0,
                    montant_total: 0
                };
            }
            
            agentsMap[agentId].total_billets++;
            agentsMap[agentId].montant_total += ticket.montant || 0;
            
            if (ticket.statut === 'validé') {
                agentsMap[agentId].validés++;
            } else if (ticket.statut === 'rejeté') {
                agentsMap[agentId].rejetés++;
            } else if (ticket.statut === 'en_attente_de_validation') {
                agentsMap[agentId].en_attente++;
            }
        });
        
        const performances_agents = Object.values(agentsMap);
        
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
                nombre_en_attente: pendingCount || 0,
                performances_agents: performances_agents
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
        
        // Statistiques générales
        const { data: subsystem, error: subsError } = await supabase
            .from('sous_systèmes')
            .select('*, stats:statistiques_du_sous_système(*)')
            .eq('id', sousSystèmeId)
            .single();
            
        if (subsError) throw subsError;
        
        // Performances des agents
        const { data: agents, error: agentsError } = await supabase
            .from('agents')
            .select(`
                id,
                nom_complet,
                nom_utilisateur,
                taux_commission,
                limite_billets,
                est_actif
            `)
            .eq('sous_système_id', sousSystèmeId)
            .eq('est_actif', true);
            
        if (agentsError) throw agentsError;
        
        // Récupérer les performances des agents
        const agentsWithPerformance = await Promise.all(
            (agents || []).map(async (agent) => {
                const today = new Date().toISOString().split('T')[0];
                
                const { data: todayTickets, error: todayError } = await supabase
                    .from('billets')
                    .select('montant, montant_gain')
                    .eq('agent_id', agent.id)
                    .eq('statut', 'validé')
                    .gte('crée_le', today + 'T00:00:00')
                    .lte('crée_le', today + 'T23:59:59');
                    
                if (todayError) throw todayError;
                
                const todaySales = (todayTickets || []).reduce((sum, t) => sum + (t.montant || 0), 0);
                const todayCommission = (todayTickets || []).reduce((sum, t) => {
                    const profit = (t.montant || 0) - (t.montant_gain || 0);
                    return sum + (profit * (agent.taux_commission || 0.1));
                }, 0);
                
                // Total du mois
                const startOfMonth = new Date();
                startOfMonth.setDate(1);
                startOfMonth.setHours(0, 0, 0, 0);
                
                const { data: monthTickets, error: monthError } = await supabase
                    .from('billets')
                    .select('montant')
                    .eq('agent_id', agent.id)
                    .eq('statut', 'validé')
                    .gte('crée_le', startOfMonth.toISOString());
                    
                if (monthError) throw monthError;
                
                const monthSales = (monthTickets || []).reduce((sum, t) => sum + (t.montant || 0), 0);
                
                return {
                    ...agent,
                    performance: {
                        ventes_aujourdhui: todaySales,
                        commission_aujourdhui: todayCommission,
                        ventes_mois: monthSales,
                        billets_aujourdhui: (todayTickets || []).length
                    }
                };
            })
        );
        
        // Tendance des ventes des 30 derniers jours
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        
        const { data: dailySales, error: salesError } = await supabase
            .from('billets')
            .select('crée_le, montant')
            .eq('sous_système_id', sousSystèmeId)
            .eq('statut', 'validé')
            .gte('crée_le', thirtyDaysAgo.toISOString())
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
            sous_système: {
                nom: subsystem.nom,
                sous_domaine: subsystem.sous_domaine,
                stats: subsystem.stats
            },
            agents: agentsWithPerformance,
            tendance_ventes: tendance_ventes,
            résumé: {
                total_agents: agents?.length || 0,
                agents_actifs: agentsWithPerformance.filter(a => a.est_actif).length,
                total_ventes_aujourdhui: agentsWithPerformance.reduce((sum, a) => sum + a.performance.ventes_aujourdhui, 0),
                total_ventes_mois: agentsWithPerformance.reduce((sum, a) => sum + a.performance.ventes_mois, 0)
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

// Gérer les agents
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

// Créer un nouvel agent
app.post('/api/supervisor/level2/agents', authenticateToken, requireSupervisorLevel(2), async (req, res) => {
    try {
        const sousSystèmeId = req.user.sous_système_id;
        
        const { 
            nom_utilisateur, 
            nom_complet, 
            email, 
            téléphone, 
            taux_commission = 0.1,
            limite_billets = 100
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
                taux_commission: taux_commission,
                limite_billets: limite_billets,
                sous_système_id: sousSystèmeId,
                est_actif: true
            })
            .select()
            .single();
            
        if (agentError) throw agentError;
        
        // Mettre à jour les statistiques du sous-système
        await updateSubsystemStats(sousSystèmeId, 0, 1);
        
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

// Rapports détaillés
app.get('/api/supervisor/level2/reports', authenticateToken, requireSupervisorLevel(2), async (req, res) => {
    try {
        const sousSystèmeId = req.user.sous_système_id;
        const { 
            type_rapport = 'quotidien',
            date_début = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            date_fin = new Date().toISOString().split('T')[0]
        } = req.query;
        
        let rapportData;
        
        if (type_rapport === 'quotidien') {
            // Rapport quotidien
            const { data: dailyTickets, error: dailyError } = await supabase
                .from('billets')
                .select(`
                    *,
                    agents(nom_complet)
                `)
                .eq('sous_système_id', sousSystèmeId)
                .eq('statut', 'validé')
                .gte('crée_le', date_début + 'T00:00:00')
                .lte('crée_le', date_fin + 'T23:59:59')
                .order('crée_le', { ascending: false });
                
            if (dailyError) throw dailyError;
            
            // Grouper par jour et par agent
            const résumé_quotidien = {};
            const résumé_agent = {};
            
            (dailyTickets || []).forEach(ticket => {
                const date = ticket.crée_le.split('T')[0];
                const agentId = ticket.agent_id;
                const agentName = ticket.agents?.nom_complet || 'Inconnu';
                
                // Résumé quotidien
                if (!résumé_quotidien[date]) {
                    résumé_quotidien[date] = {
                        date: date,
                        billets: 0,
                        ventes: 0,
                        gains: 0,
                        profit: 0
                    };
                }
                résumé_quotidien[date].billets += 1;
                résumé_quotidien[date].ventes += ticket.montant || 0;
                résumé_quotidien[date].gains += ticket.montant_gain || 0;
                résumé_quotidien[date].profit += (ticket.montant || 0) - (ticket.montant_gain || 0);
                
                // Résumé agent
                if (!résumé_agent[agentId]) {
                    résumé_agent[agentId] = {
                        agent_id: agentId,
                        nom_agent: agentName,
                        billets: 0,
                        ventes: 0,
                        gains: 0,
                        profit: 0,
                        commission: 0
                    };
                }
                résumé_agent[agentId].billets += 1;
                résumé_agent[agentId].ventes += ticket.montant || 0;
                résumé_agent[agentId].gains += ticket.montant_gain || 0;
                const profit = (ticket.montant || 0) - (ticket.montant_gain || 0);
                résumé_agent[agentId].profit += profit;
                
                // Trouver le taux de commission de l'agent
                const agentCommissionRate = 0.1; // Par défaut
                résumé_agent[agentId].commission += profit * agentCommissionRate;
            });
            
            rapportData = {
                résumé_quotidien: Object.values(résumé_quotidien),
                résumé_agent: Object.values(résumé_agent),
                total_billets: (dailyTickets || []).length,
                total_ventes: Object.values(résumé_quotidien).reduce((sum, day) => sum + day.ventes, 0),
                total_profit: Object.values(résumé_quotidien).reduce((sum, day) => sum + day.profit, 0)
            };
            
        } else if (type_rapport === 'type_jeu') {
            // Rapport par type de jeu
            const { data: tickets, error: ticketsError } = await supabase
                .from('billets')
                .select('type_jeu, montant, montant_gain')
                .eq('sous_système_id', sousSystèmeId)
                .eq('statut', 'validé')
                .gte('crée_le', date_début + 'T00:00:00')
                .lte('crée_le', date_fin + 'T23:59:59');
                
            if (ticketsError) throw ticketsError;
            
            const résumé_type_jeu = {};
            
            (tickets || []).forEach(ticket => {
                const typeJeu = ticket.type_jeu;
                if (!résumé_type_jeu[typeJeu]) {
                    résumé_type_jeu[typeJeu] = {
                        type_jeu: typeJeu,
                        billets: 0,
                        ventes: 0,
                        gains: 0,
                        profit: 0
                    };
                }
                résumé_type_jeu[typeJeu].billets += 1;
                résumé_type_jeu[typeJeu].ventes += ticket.montant || 0;
                résumé_type_jeu[typeJeu].gains += ticket.montant_gain || 0;
                résumé_type_jeu[typeJeu].profit += (ticket.montant || 0) - (ticket.montant_gain || 0);
            });
            
            rapportData = {
                résumé_type_jeu: Object.values(résumé_type_jeu)
            };
        }
        
        res.json({
            success: true,
            rapport: rapportData
        });
        
    } catch (error) {
        console.error('Erreur génération rapport:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Erreur serveur' 
        });
    }
});

// ============================================
// ROUTES ADMIN SOUS-SYSTÈME
// ============================================

// Dashboard admin sous-système
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
        
        // Statistiques détaillées
        const today = new Date().toISOString().split('T')[0];
        
        // Tickets d'aujourd'hui
        const { data: todayTickets, error: todayError } = await supabase
            .from('billets')
            .select('montant, montant_gain, statut')
            .eq('sous_système_id', sousSystèmeId)
            .gte('crée_le', today + 'T00:00:00')
            .lte('crée_le', today + 'T23:59:59');
            
        if (todayError) throw todayError;
        
        const todaySales = (todayTickets || []).reduce((sum, t) => sum + (t.montant || 0), 0);
        const todayPayout = (todayTickets || []).reduce((sum, t) => sum + (t.montant_gain || 0), 0);
        const todayProfit = todaySales - todayPayout;
        
        // Utilisateurs
        const { data: agents, error: agentsError } = await supabase
            .from('agents')
            .select('id, est_actif')
            .eq('sous_système_id', sousSystèmeId);
            
        const { data: supervisors, error: supersError } = await supabase
            .from('superviseurs')
            .select('id, est_actif')
            .eq('sous_système_id', sousSystèmeId);
            
        if (agentsError) throw agentsError;
        if (supersError) throw supersError;
        
        const activeAgents = (agents || []).filter(a => a.est_actif).length;
        const activeSupervisors = (supervisors || []).filter(s => s.est_actif).length;
        
        // Performance des 7 derniers jours
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        
        const { data: weeklyTickets, error: weeklyError } = await supabase
            .from('billets')
            .select('crée_le, montant, montant_gain')
            .eq('sous_système_id', sousSystèmeId)
            .eq('statut', 'validé')
            .gte('crée_le', sevenDaysAgo.toISOString())
            .order('crée_le', { ascending: true });
            
        if (weeklyError) throw weeklyError;
        
        // Grouper par jour
        const stats_hebdomadaires = {};
        (weeklyTickets || []).forEach(ticket => {
            const date = ticket.crée_le.split('T')[0];
            if (!stats_hebdomadaires[date]) {
                stats_hebdomadaires[date] = { ventes: 0, profit: 0, billets: 0 };
            }
            stats_hebdomadaires[date].ventes += ticket.montant || 0;
            stats_hebdomadaires[date].profit += (ticket.montant || 0) - (ticket.montant_gain || 0);
            stats_hebdomadaires[date].billets += 1;
        });
        
        // Meilleurs agents du mois
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);
        
        const { data: topAgents, error: topError } = await supabase
            .from('billets')
            .select(`
                agent_id,
                agents(nom_complet),
                montant
            `)
            .eq('sous_système_id', sousSystèmeId)
            .eq('statut', 'validé')
            .gte('crée_le', startOfMonth.toISOString())
            .order('montant', { ascending: false })
            .limit(5);
            
        if (topError) throw topError;
        
        // Grouper par agent
        const ventes_agent = {};
        (topAgents || []).forEach(ticket => {
            const agentId = ticket.agent_id;
            const agentName = ticket.agents?.nom_complet || 'Inconnu';
            
            if (!ventes_agent[agentId]) {
                ventes_agent[agentId] = {
                    agent_id: agentId,
                    nom_agent: agentName,
                    ventes: 0
                };
            }
            ventes_agent[agentId].ventes += ticket.montant || 0;
        });
        
        const meilleurs_performeurs = Object.values(ventes_agent)
            .sort((a, b) => b.ventes - a.ventes)
            .slice(0, 5);
        
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
                    total_agents: agents?.length || 0,
                    agents_actifs: activeAgents,
                    total_superviseurs: supervisors?.length || 0,
                    superviseurs_actifs: activeSupervisors,
                    pourcentage_utilisation: subsystem.stats?.pourcentage_utilisation || 0
                },
                stats_hebdomadaires: stats_hebdomadaires,
                meilleurs_performeurs: meilleurs_performeurs
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

// Gérer les utilisateurs du sous-système
app.get('/api/subsystem/users', authenticateToken, requireRole('subsystem_admin'), async (req, res) => {
    try {
        const sousSystèmeId = req.user.sous_système_id;
        const { type_utilisateur } = req.query; // 'agents', 'superviseurs', 'tous'
        
        let utilisateurs = [];
        
        if (!type_utilisateur || type_utilisateur === 'agents' || type_utilisateur === 'tous') {
            const { data: agents, error: agentsError } = await supabase
                .from('agents')
                .select('*')
                .eq('sous_système_id', sousSystèmeId)
                .order('crée_le', { ascending: false });
                
            if (agentsError) throw agentsError;
            
            utilisateurs = utilisateurs.concat((agents || []).map(agent => ({
                ...agent,
                type_utilisateur: 'agent'
            })));
        }
        
        if (!type_utilisateur || type_utilisateur === 'superviseurs' || type_utilisateur === 'tous') {
            const { data: superviseurs, error: supersError } = await supabase
                .from('superviseurs')
                .select('*')
                .eq('sous_système_id', sousSystèmeId)
                .order('crée_le', { ascending: false });
                
            if (supersError) throw supersError;
            
            utilisateurs = utilisateurs.concat((superviseurs || []).map(superviseur => ({
                ...superviseur,
                type_utilisateur: 'superviseur'
            })));
        }
        
        res.json({
            success: true,
            utilisateurs: utilisateurs
        });
        
    } catch (error) {
        console.error('Erreur récupération utilisateurs:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Erreur serveur' 
        });
    }
});

// Activer/désactiver un utilisateur
app.put('/api/subsystem/users/:id/toggle', authenticateToken, requireRole('subsystem_admin'), async (req, res) => {
    try {
        const { id } = req.params;
        const { type_utilisateur, est_actif } = req.body; // type_utilisateur: 'agent' ou 'superviseur'
        
        if (!type_utilisateur) {
            return res.status(400).json({ 
                success: false, 
                error: 'Type d\'utilisateur requis' 
            });
        }
        
        let tableName;
        if (type_utilisateur === 'agent') {
            tableName = 'agents';
        } else if (type_utilisateur === 'superviseur') {
            tableName = 'superviseurs';
        } else {
            return res.status(400).json({ 
                success: false, 
                error: 'Type d\'utilisateur invalide' 
            });
        }
        
        // Vérifier que l'utilisateur appartient au sous-système
        const { data: utilisateur, error: userError } = await supabase
            .from(tableName)
            .select('sous_système_id')
            .eq('id', id)
            .single();
            
        if (userError) throw userError;
        
        if (utilisateur.sous_système_id !== req.user.sous_système_id) {
            return res.status(403).json({ 
                success: false, 
                error: 'Utilisateur non autorisé' 
            });
        }
        
        // Mettre à jour le statut
        const { data: updatedUser, error: updateError } = await supabase
            .from(tableName)
            .update({ 
                est_actif: est_actif !== undefined ? est_actif : !utilisateur.est_actif,
                mis_à_jour_le: new Date().toISOString()
            })
            .eq('id', id)
            .select()
            .single();
            
        if (updateError) throw updateError;
        
        // Mettre à jour les statistiques du sous-système
        const { data: stats } = await supabase
            .from('statistiques_du_sous_système')
            .select('utilisateurs_actifs')
            .eq('sous_système_id', req.user.sous_système_id)
            .single();
            
        if (stats) {
            const newActiveUsers = est_actif ? 
                Math.min(stats.utilisateurs_actifs + 1, stats.utilisateurs_max || 10) : 
                Math.max(stats.utilisateurs_actifs - 1, 0);
                
            const usagePercentage = Math.round((newActiveUsers / (stats.utilisateurs_max || 10)) * 100);
            
            await supabase
                .from('statistiques_du_sous_système')
                .update({
                    utilisateurs_actifs: newActiveUsers,
                    pourcentage_utilisation: usagePercentage,
                    mis_à_jour_le: new Date().toISOString()
                })
                .eq('sous_système_id', req.user.sous_système_id);
        }
        
        res.json({
            success: true,
            message: `Utilisateur ${est_actif ? 'activé' : 'désactivé'} avec succès`,
            utilisateur: updatedUser
        });
        
    } catch (error) {
        console.error('Erreur modification utilisateur:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Erreur serveur' 
        });
    }
});

// Modifier les paramètres du sous-système
app.put('/api/subsystem/settings', authenticateToken, requireRole('subsystem_admin'), async (req, res) => {
    try {
        const sousSystèmeId = req.user.sous_système_id;
        const updates = req.body;
        
        // N'autoriser que certains champs à être modifiés
        const allowedUpdates = [
            'email_contact', 'téléphone_contact', 'utilisateurs_max'
        ];
        
        const filteredUpdates = {};
        Object.keys(updates).forEach(key => {
            if (allowedUpdates.includes(key)) {
                filteredUpdates[key] = updates[key];
            }
        });
        
        if (Object.keys(filteredUpdates).length === 0) {
            return res.status(400).json({ 
                success: false, 
                error: 'Aucune modification valide' 
            });
        }
        
        const { data: updatedSubsystem, error } = await supabase
            .from('sous_systèmes')
            .update(filteredUpdates)
            .eq('id', sousSystèmeId)
            .select()
            .single();
            
        if (error) throw error;
        
        res.json({
            success: true,
            message: 'Paramètres mis à jour',
            sous_système: updatedSubsystem
        });
        
    } catch (error) {
        console.error('Erreur modification paramètres:', error);
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
        const { mot_de_passe_actuel, nouveau_mot_de_passe } = req.body;
        const userId = req.user.sub;
        const userRole = req.user.role;
        
        if (!mot_de_passe_actuel || !nouveau_mot_de_passe) {
            return res.status(400).json({ 
                success: false, 
                error: 'Mot de passe actuel et nouveau mot de passe requis' 
            });
        }
        
        if (nouveau_mot_de_passe.length < 8) {
            return res.status(400).json({ 
                success: false, 
                error: 'Le nouveau mot de passe doit faire au moins 8 caractères' 
            });
        }
        
        // Déterminer la table en fonction du rôle
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
        
        // Récupérer l'utilisateur
        const { data: utilisateur, error: userError } = await supabase
            .from(tableName)
            .select('hash_mot_de_passe')
            .eq('id', userId)
            .single();
            
        if (userError) throw userError;
        
        // Vérifier le mot de passe actuel
        const currentHash = Buffer.from(mot_de_passe_actuel + 'nova-lotto-salt').toString('base64');
        if (utilisateur.hash_mot_de_passe !== currentHash) {
            return res.status(401).json({ 
                success: false, 
                error: 'Mot de passe actuel incorrect' 
            });
        }
        
        // Mettre à jour avec le nouveau mot de passe
        const newHash = Buffer.from(nouveau_mot_de_passe + 'nova-lotto-salt').toString('base64');
        
        const { error: updateError } = await supabase
            .from(tableName)
            .update({ 
                hash_mot_de_passe: newHash,
                mis_à_jour_le: new Date().toISOString()
            })
            .eq('id', userId);
            
        if (updateError) throw updateError;
        
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
        
        const { data: utilisateur, error } = await supabase
            .from(tableName)
            .select(selectFields)
            .eq('id', userId)
            .single();
            
        if (error) throw error;
        
        // Masquer le hash du mot de passe
        const { hash_mot_de_passe, ...safeUser } = utilisateur;
        
        res.json({
            success: true,
            profil: safeUser
        });
        
    } catch (error) {
        console.error('Erreur récupération profil:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Erreur serveur' 
        });
    }
});

// Mettre à jour le profil
app.put('/api/user/profile', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.sub;
        const userRole = req.user.role;
        const updates = req.body;
        
        // N'autoriser que certains champs
        const allowedUpdates = [
            'nom_complet', 'email', 'téléphone'
        ];
        
        const filteredUpdates = {};
        Object.keys(updates).forEach(key => {
            if (allowedUpdates.includes(key)) {
                filteredUpdates[key] = updates[key];
            }
        });
        
        if (Object.keys(filteredUpdates).length === 0) {
            return res.status(400).json({ 
                success: false, 
                error: 'Aucune modification valide' 
            });
        }
        
        // Déterminer la table
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
        
        const { data: updatedUser, error } = await supabase
            .from(tableName)
            .update({
                ...filteredUpdates,
                mis_à_jour_le: new Date().toISOString()
            })
            .eq('id', userId)
            .select()
            .single();
            
        if (error) throw error;
        
        // Masquer le hash du mot de passe
        const { hash_mot_de_passe, ...safeUser } = updatedUser;
        
        res.json({
            success: true,
            message: 'Profil mis à jour',
            profil: safeUser
        });
        
    } catch (error) {
        console.error('Erreur mise à jour profil:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Erreur serveur' 
        });
    }
});

// ============================================
// FONCTIONS UTILITAIRES
// ============================================

// Générer un mot de passe aléatoire
function generateRandomPassword(length = 10) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
    let password = '';
    for (let i = 0; i < length; i++) {
        password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
}

// Calculer le gain selon le type de jeu
function calculatePayout(typeJeu, montant) {
    const multiplicateurs = {
        'borlette': 70,
        'lotto-3': 500,
        'lotto-4': 5000,
        'lotto-5': 75000,
        'grap': 7,
        'marriage': 35
    };
    
    const multiplicateur = multiplicateurs[typeJeu] || 1;
    return parseFloat(montant) * multiplicateur;
}

// Mettre à jour les statistiques du sous-système
async function updateSubsystemStats(sousSystèmeId, montant = 0, changementUtilisateur = 0) {
    try {
        const today = new Date().toISOString().split('T')[0];
        
        // Récupérer les statistiques actuelles
        const { data: stats, error: statsError } = await supabase
            .from('statistiques_du_sous_système')
            .select('*')
            .eq('sous_système_id', sousSystèmeId)
            .single();
            
        if (statsError && statsError.code === 'PGRST116') {
            // Pas encore de statistiques, les créer
            await supabase
                .from('statistiques_du_sous_système')
                .insert({
                    sous_système_id: sousSystèmeId,
                    utilisateurs_actifs: Math.max(changementUtilisateur, 0),
                    billets_aujourdhui: montant > 0 ? 1 : 0,
                    ventes_aujourdhui: montant,
                    billets_totaux: montant > 0 ? 1 : 0,
                    ventes_totales: montant,
                    pourcentage_utilisation: 0,
                    mis_à_jour_le: new Date().toISOString()
                });
            return;
        }
        
        if (statsError) throw statsError;
        
        // Mettre à jour les statistiques
        const updates = {
            mis_à_jour_le: new Date().toISOString()
        };
        
        // Vérifier si c'est un nouveau jour
        const lastUpdated = new Date(stats.mis_à_jour_le);
        const todayDate = new Date();
        
        if (lastUpdated.toISOString().split('T')[0] !== today) {
            // Réinitialiser les stats du jour
            updates.billets_aujourdhui = montant > 0 ? 1 : 0;
            updates.ventes_aujourdhui = montant;
        } else {
            // Ajouter aux stats du jour
            updates.billets_aujourdhui = (stats.billets_aujourdhui || 0) + (montant > 0 ? 1 : 0);
            updates.ventes_aujourdhui = (stats.ventes_aujourdhui || 0) + montant;
        }
        
        // Mettre à jour les totaux
        updates.billets_totaux = (stats.billets_totaux || 0) + (montant > 0 ? 1 : 0);
        updates.ventes_totales = (stats.ventes_totales || 0) + montant;
        
        // Mettre à jour les utilisateurs actifs
        if (changementUtilisateur !== 0) {
            const newActiveUsers = Math.max((stats.utilisateurs_actifs || 0) + changementUtilisateur, 0);
            updates.utilisateurs_actifs = newActiveUsers;
            
            // Récupérer le nombre max d'utilisateurs
            const { data: subsystem } = await supabase
                .from('sous_systèmes')
                .select('utilisateurs_max')
                .eq('id', sousSystèmeId)
                .single();
                
            if (subsystem) {
                updates.pourcentage_utilisation = Math.round((newActiveUsers / subsystem.utilisateurs_max) * 100);
            }
        }
        
        await supabase
            .from('statistiques_du_sous_système')
            .update(updates)
            .eq('sous_système_id', sousSystèmeId);
            
    } catch (error) {
        console.error('Erreur mise à jour statistiques:', error);
    }
}

// ============================================
// GESTION DES FICHIERS STATIQUES
// ============================================

// Redirection pour les pages principales
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/master', (req, res) => {
    res.sendFile(path.join(__dirname, 'master-dashboard.html'));
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

app.get('/subsystem-admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'subsystem-admin.html'));
});

// Gestion des erreurs 404 pour les fichiers HTML
app.get('*.html', (req, res, next) => {
    const filePath = path.join(__dirname, req.path);
    if (!require('fs').existsSync(filePath)) {
        return res.status(404).sendFile(path.join(__dirname, 'login.html'));
    }
    next();
});

// Gestion des erreurs
app.use((err, req, res, next) => {
    console.error('Erreur non gérée:', err);
    res.status(500).json({ 
        success: false, 
        error: 'Erreur interne du serveur',
        message: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

// ============================================
// DÉMARRAGE DU SERVEUR
// ============================================

app.listen(PORT, () => {
    console.log(`🚀 Serveur Nova Lotto démarré sur le port ${PORT}`);
    console.log(`📊 Supabase connecté: ${supabaseUrl}`);
    console.log(`🌐 URLs disponibles:`);
    console.log(`   • Login: http://localhost:${PORT}/`);
    console.log(`   • Master: http://localhost:${PORT}/master-dashboard.html`);
    console.log(`   • Agent: http://localhost:${PORT}/index.html`);
    console.log(`   • Superviseur N1: http://localhost:${PORT}/control-level1.html`);
    console.log(`   • Superviseur N2: http://localhost:${PORT}/control-level2.html`);
    console.log(`   • Admin Sous-système: http://localhost:${PORT}/subsystem-admin.html`);
});
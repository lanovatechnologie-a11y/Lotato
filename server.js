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
        const { data, error } = await supabase.from('utilisateurs_maitre').select('count');
        
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
            .select('*, sous_systemes(name, subdomain, is_active)')
            .eq('username', username)
            .eq('is_active', true)
            .single();
            
        if (error || !data) {
            return res.status(401).json({ 
                success: false, 
                error: 'Identifiants incorrects ou compte inactif' 
            });
        }
        
        // Vérifier si le sous-système est actif
        if (!data.sous_systemes?.is_active) {
            return res.status(403).json({ 
                success: false, 
                error: 'Ce sous-système est temporairement désactivé' 
            });
        }
        
        // Vérifier le mot de passe
        const passwordHash = Buffer.from(password + 'nova-lotto-salt').toString('base64');
        if (data.password_hash !== passwordHash) {
            return res.status(401).json({ 
                success: false, 
                error: 'Mot de passe incorrect' 
            });
        }
        
        // Générer le token
        const token = Buffer.from(JSON.stringify({
            sub: data.id,
            role: 'agent',
            subsystem_id: data.subsystem_id,
            subsystem_name: data.sous_systemes?.name,
            exp: Date.now() + 86400000 // 24h
        })).toString('base64');
        
        res.json({
            success: true,
            token: token,
            user: {
                id: data.id,
                username: data.username,
                full_name: data.full_name,
                email: data.email,
                phone: data.phone,
                role: 'agent',
                subsystem_id: data.subsystem_id,
                subsystem_name: data.sous_systemes?.name,
                subdomain: data.sous_systemes?.subdomain,
                commission_rate: data.commission_rate,
                ticket_limit: data.ticket_limit
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
            .select('*, sous_systemes(name, subdomain, is_active)')
            .eq('username', username)
            .eq('is_active', true)
            .single();
            
        if (error || !data) {
            return res.status(401).json({ 
                success: false, 
                error: 'Identifiants incorrects ou compte inactif' 
            });
        }
        
        // Vérifier le niveau si spécifié
        if (level && data.level !== parseInt(level)) {
            return res.status(401).json({ 
                success: false, 
                error: 'Niveau de supervision incorrect' 
            });
        }
        
        // Vérifier si le sous-système est actif
        if (!data.sous_systemes?.is_active) {
            return res.status(403).json({ 
                success: false, 
                error: 'Ce sous-système est temporairement désactivé' 
            });
        }
        
        // Vérifier le mot de passe
        const passwordHash = Buffer.from(password + 'nova-lotto-salt').toString('base64');
        if (data.password_hash !== passwordHash) {
            return res.status(401).json({ 
                success: false, 
                error: 'Mot de passe incorrect' 
            });
        }
        
        // Générer le token
        const token = Buffer.from(JSON.stringify({
            sub: data.id,
            role: 'supervisor',
            level: data.level,
            subsystem_id: data.subsystem_id,
            subsystem_name: data.sous_systemes?.name,
            exp: Date.now() + 86400000
        })).toString('base64');
        
        res.json({
            success: true,
            token: token,
            user: {
                id: data.id,
                username: data.username,
                full_name: data.full_name,
                email: data.email,
                phone: data.phone,
                role: 'supervisor',
                level: data.level,
                subsystem_id: data.subsystem_id,
                subsystem_name: data.sous_systemes?.name,
                subdomain: data.sous_systemes?.subdomain,
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
            .from('admins_sous_systeme')
            .select('*, sous_systemes(*, stats:statistiques_sous_systeme(*))')
            .eq('username', username)
            .eq('is_active', true)
            .single();
            
        if (error || !data) {
            return res.status(401).json({ 
                success: false, 
                error: 'Identifiants incorrects ou compte inactif' 
            });
        }
        
        // Vérifier si le sous-système est actif
        if (!data.sous_systemes?.is_active) {
            return res.status(403).json({ 
                success: false, 
                error: 'Ce sous-système est temporairement désactivé' 
            });
        }
        
        // Vérifier le mot de passe
        const passwordHash = Buffer.from(password + 'nova-lotto-salt').toString('base64');
        if (data.password_hash !== passwordHash) {
            return res.status(401).json({ 
                success: false, 
                error: 'Mot de passe incorrect' 
            });
        }
        
        // Générer le token
        const token = Buffer.from(JSON.stringify({
            sub: data.id,
            role: 'subsystem_admin',
            subsystem_id: data.subsystem_id,
            exp: Date.now() + 86400000
        })).toString('base64');
        
        res.json({
            success: true,
            token: token,
            user: {
                id: data.id,
                username: data.username,
                full_name: data.full_name,
                email: data.email,
                phone: data.phone,
                role: 'subsystem_admin',
                subsystem_id: data.subsystem_id,
                permissions: data.permissions || []
            },
            subsystem: {
                id: data.sous_systemes.id,
                name: data.sous_systemes.name,
                subdomain: data.sous_systemes.subdomain,
                contact_email: data.sous_systemes.contact_email,
                contact_phone: data.sous_systemes.contact_phone,
                max_users: data.sous_systemes.max_users,
                subscription_type: data.sous_systemes.subscription_type,
                subscription_expires: data.sous_systemes.subscription_expires,
                is_active: data.sous_systemes.is_active,
                stats: data.sous_systemes.stats
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
            .from('utilisateurs_maitre')
            .select('*')
            .eq('username', username)
            .eq('is_active', true)
            .single();
            
        if (error || !data) {
            return res.status(401).json({ 
                success: false, 
                error: 'Identifiants incorrects ou compte inactif' 
            });
        }
        
        // Vérifier le mot de passe
        const passwordHash = Buffer.from(password + 'nova-lotto-salt').toString('base64');
        if (data.password_hash !== passwordHash) {
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
                username: data.username,
                full_name: data.full_name,
                email: data.email,
                phone: data.phone,
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
            .from('utilisateurs_maitre')
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
            .from('utilisateurs_maitre')
            .insert({
                username: masterUsername,
                password_hash: passwordHash,
                full_name: companyName || 'Administrateur Master',
                email: masterEmail,
                is_active: true,
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
                username: data.username,
                full_name: data.full_name,
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
            sort_by = 'created_at',
            sort_order = 'desc'
        } = req.query;
        
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const from = (pageNum - 1) * limitNum;
        
        let query = supabase
            .from('sous_systemes')
            .select('*, stats:statistiques_sous_systeme(*)', { count: 'exact' });
            
        // Appliquer les filtres
        if (status === 'active') {
            query = query.eq('is_active', true);
        } else if (status === 'inactive') {
            query = query.eq('is_active', false);
        } else if (status === 'expired') {
            query = query.lt('subscription_expires', new Date().toISOString());
        }
        
        if (search) {
            query = query.or(`name.ilike.%${search}%,subdomain.ilike.%${search}%,contact_email.ilike.%${search}%`);
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
            
            if (subsystem.subscription_expires) {
                const expireDate = new Date(subsystem.subscription_expires);
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
            sous_systemes: subsystemsWithDetails,
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
            .from('sous_systemes')
            .select('*', { count: 'exact', head: true });
            
        const { count: activeSubsystems } = await supabase
            .from('sous_systemes')
            .select('*', { count: 'exact', head: true })
            .eq('is_active', true);
            
        // Compter tous les utilisateurs
        const { count: totalAgents } = await supabase
            .from('agents')
            .select('*', { count: 'exact', head: true })
            .eq('is_active', true);
            
        const { count: totalSupervisors } = await supabase
            .from('superviseurs')
            .select('*', { count: 'exact', head: true })
            .eq('is_active', true);
            
        const { count: totalAdmins } = await supabase
            .from('admins_sous_systeme')
            .select('*', { count: 'exact', head: true })
            .eq('is_active', true);
            
        const totalUsers = (totalAgents || 0) + (totalSupervisors || 0) + (totalAdmins || 0);
        
        // Revenu estimé
        const { data: sous_systemes } = await supabase
            .from('sous_systemes')
            .select('subscription_type, created_at, is_active');
            
        const monthlyRevenue = sous_systemes?.reduce((sum, sys) => {
            if (!sys.is_active) return sum;
            
            const basePrice = {
                basic: 3000,
                standard: 5000,
                premium: 8000,
                enterprise: 15000
            }[sys.subscription_type] || 3000;
            
            return sum + basePrice;
        }, 0) || 0;
        
        // Sous-systèmes expirant bientôt
        const { count: expiringSoon } = await supabase
            .from('sous_systemes')
            .select('*', { count: 'exact', head: true })
            .lt('subscription_expires', new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString())
            .gt('subscription_expires', new Date().toISOString());
            
        // Tickets aujourd'hui (estimation)
        const { count: todayTickets } = await supabase
            .from('billets')
            .select('*', { count: 'exact', head: true })
            .gte('created_at', new Date().toISOString().split('T')[0]);
            
        res.json({
            success: true,
            stats: {
                total_sous_systemes: totalSubsystems || 0,
                active_sous_systemes: activeSubsystems || 0,
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
            name, 
            subdomain, 
            contact_email, 
            contact_phone, 
            max_users = 10, 
            subscription_type = 'standard', 
            subscription_months = 1,
            send_credentials = true
        } = req.body;
        
        // Validation
        if (!name || !subdomain || !contact_email) {
            return res.status(400).json({ 
                success: false, 
                error: 'Nom, sous-domaine et email sont requis' 
            });
        }
        
        // Vérifier le format du sous-domaine
        if (!/^[a-z0-9-]+$/.test(subdomain)) {
            return res.status(400).json({ 
                success: false, 
                error: 'Le sous-domaine ne peut contenir que des lettres minuscules, chiffres et tirets' 
            });
        }
        
        // Vérifier si le sous-domaine existe déjà
        const { count: existingCount } = await supabase
            .from('sous_systemes')
            .select('*', { count: 'exact', head: true })
            .eq('subdomain', subdomain);
            
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
        const { data: sous_systeme, error: sousSystemeError } = await supabase
            .from('sous_systemes')
            .insert({
                name: name,
                subdomain: subdomain,
                contact_email: contact_email,
                contact_phone: contact_phone,
                max_users: max_users,
                subscription_type: subscription_type,
                subscription_expires: subscriptionExpires.toISOString(),
                is_active: true
            })
            .select()
            .single();
            
        if (sousSystemeError) {
            console.error('Erreur création sous-système:', sousSystemeError);
            return res.status(500).json({ 
                success: false, 
                error: 'Erreur création sous-système' 
            });
        }
        
        // Générer les identifiants admin
        const adminUsername = subdomain + '_admin';
        const adminPassword = generateRandomPassword(10);
        const adminPasswordHash = Buffer.from(adminPassword + 'nova-lotto-salt').toString('base64');
        
        // Créer l'admin du sous-système
        const { data: admin, error: adminError } = await supabase
            .from('admins_sous_systeme')
            .insert({
                username: adminUsername,
                password_hash: adminPasswordHash,
                full_name: `Administrateur ${name}`,
                email: contact_email,
                phone: contact_phone,
                subsystem_id: sous_systeme.id,
                is_active: true,
                permissions: JSON.stringify(['full_access'])
            })
            .select()
            .single();
            
        if (adminError) {
            // Rollback: supprimer le sous-système
            await supabase.from('sous_systemes').delete().eq('id', sous_systeme.id);
            console.error('Erreur création admin:', adminError);
            return res.status(500).json({ 
                success: false, 
                error: 'Erreur création administrateur' 
            });
        }
        
        // Créer les statistiques initiales
        await supabase
            .from('statistiques_sous_systeme')
            .insert({
                subsystem_id: sous_systeme.id,
                active_users: 1,
                today_tickets: 0,
                today_sales: 0,
                total_tickets: 0,
                total_sales: 0,
                usage_percentage: Math.round((1 / max_users) * 100)
            });
        
        // URL d'accès
        const host = req.get('host');
        const protocol = req.protocol;
        const accessUrl = `${protocol}://${subdomain}.${host.replace('master.', '') || 'novalotto.com'}`;
        
        res.json({
            success: true,
            message: 'Sous-système créé avec succès',
            sous_systeme: sous_systeme,
            admin_credentials: {
                username: adminUsername,
                password: adminPassword,
                email: contact_email,
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
            .from('sous_systemes')
            .select(`
                *,
                stats:statistiques_sous_systeme(*),
                admins:admins_sous_systeme(count),
                agents:agents(count),
                superviseurs:superviseurs(count),
                recent_billets:billets(count)
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
        if (data.subscription_expires) {
            const expireDate = new Date(data.subscription_expires);
            const now = new Date();
            daysLeft = Math.ceil((expireDate - now) / (1000 * 60 * 60 * 24));
        }
        
        res.json({
            success: true,
            sous_systeme: {
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
            .from('sous_systemes')
            .update({ 
                is_active: false,
                deactivated_at: new Date().toISOString()
            })
            .eq('id', id)
            .select()
            .single();
            
        if (error) throw error;
        
        res.json({
            success: true,
            message: 'Sous-système désactivé avec succès',
            sous_systeme: data
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
            .from('sous_systemes')
            .update({ 
                is_active: true,
                deactivated_at: null
            })
            .eq('id', id)
            .select()
            .single();
            
        if (error) throw error;
        
        res.json({
            success: true,
            message: 'Sous-système activé avec succès',
            sous_systeme: data
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
        const { data: sous_systeme, error: fetchError } = await supabase
            .from('sous_systemes')
            .select('subscription_expires')
            .eq('id', id)
            .single();
            
        if (fetchError) throw fetchError;
        
        // Calculer la nouvelle date d'expiration
        let newExpiryDate;
        if (sous_systeme.subscription_expires) {
            newExpiryDate = new Date(sous_systeme.subscription_expires);
        } else {
            newExpiryDate = new Date();
        }
        
        newExpiryDate.setMonth(newExpiryDate.getMonth() + months);
        
        // Mettre à jour
        const { data, error } = await supabase
            .from('sous_systemes')
            .update({ 
                subscription_expires: newExpiryDate.toISOString(),
                is_active: true
            })
            .eq('id', id)
            .select()
            .single();
            
        if (error) throw error;
        
        res.json({
            success: true,
            message: `Abonnement renouvelé pour ${months} mois`,
            sous_systeme: data
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
        const { data: sous_systemes, error: subsError } = await supabase
            .from('sous_systemes')
            .select('id, name, subdomain, subscription_type')
            .eq('is_active', true);
            
        if (subsError) throw subsError;
        
        // Pour chaque sous-système, récupérer les statistiques
        const sous_systemesDetail = [];
        let totalTickets = 0;
        let totalSales = 0;
        let totalPayout = 0;
        
        for (const sous_systeme of sous_systemes) {
            // Récupérer les billets du sous-système pour la période
            const { data: billets, error: billetsError } = await supabase
                .from('billets')
                .select('amount, payout_amount')
                .eq('subsystem_id', sous_systeme.id)
                .gte('created_at', start_date)
                .lte('created_at', end_date + 'T23:59:59');
                
            if (billetsError) throw billetsError;
            
            const sous_systemeBillets = billets || [];
            const sous_systemeSales = sous_systemeBillets.reduce((sum, t) => sum + (t.amount || 0), 0);
            const sous_systemePayout = sous_systemeBillets.reduce((sum, t) => sum + (t.payout_amount || 0), 0);
            const sous_systemeProfit = sous_systemeSales - sous_systemePayout;
            
            sous_systemesDetail.push({
                sous_systeme_id: sous_systeme.id,
                sous_systeme_name: sous_systeme.name,
                subdomain: sous_systeme.subdomain,
                billets_count: sous_systemeBillets.length,
                total_sales: sous_systemeSales,
                total_payout: sous_systemePayout,
                profit: sous_systemeProfit
            });
            
            totalTickets += sous_systemeBillets.length;
            totalSales += sous_systemeSales;
            totalPayout += sous_systemePayout;
        }
        
        // Générer le breakdown quotidien
        const dailyBreakdown = [];
        const start = new Date(start_date);
        const end = new Date(end_date);
        
        for (let date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
            const dateStr = date.toISOString().split('T')[0];
            
            // Récupérer les billets pour ce jour
            const { data: dailyBillets, error: dailyError } = await supabase
                .from('billets')
                .select('amount')
                .gte('created_at', dateStr + 'T00:00:00')
                .lte('created_at', dateStr + 'T23:59:59');
                
            if (dailyError) throw dailyError;
            
            const dailySales = (dailyBillets || []).reduce((sum, t) => sum + (t.amount || 0), 0);
            
            dailyBreakdown.push({
                date: dateStr,
                billet_count: (dailyBillets || []).length,
                total_amount: dailySales,
                avg_billet_amount: (dailyBillets || []).length > 0 ? 
                    dailySales / (dailyBillets || []).length : 0
            });
        }
        
        res.json({
            success: true,
            report: {
                period: { 
                    start_date: start_date, 
                    end_date: end_date 
                },
                total_sous_systemes: sous_systemes?.length || 0,
                summary: {
                    total_billets: totalTickets,
                    total_sales: totalSales,
                    total_payout: totalPayout,
                    total_profit: totalSales - totalPayout,
                    avg_daily_sales: totalSales / Math.max(1, dailyBreakdown.length),
                    avg_billet_amount: totalTickets > 0 ? totalSales / totalTickets : 0
                },
                sous_systemes_detail: sous_systemesDetail,
                daily_breakdown: dailyBreakdown
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
        const subsystemId = req.user.subsystem_id;
        
        // Récupérer les informations de l'agent
        const { data: agent, error: agentError } = await supabase
            .from('agents')
            .select('*, sous_systemes(name, subdomain)')
            .eq('id', agentId)
            .single();
            
        if (agentError) throw agentError;
        
        // Statistiques du jour
        const today = new Date().toISOString().split('T')[0];
        
        const { data: todayBillets, error: billetsError } = await supabase
            .from('billets')
            .select('amount, payout_amount, status')
            .eq('agent_id', agentId)
            .gte('created_at', today + 'T00:00:00')
            .lte('created_at', today + 'T23:59:59');
            
        if (billetsError) throw billetsError;
        
        const todaySales = (todayBillets || []).reduce((sum, t) => sum + (t.amount || 0), 0);
        const todayPayout = (todayBillets || []).reduce((sum, t) => sum + (t.payout_amount || 0), 0);
        const todayProfit = todaySales - todayPayout;
        
        // Billets en attente de validation
        const { data: pendingBillets, error: pendingError } = await supabase
            .from('billets')
            .select('count')
            .eq('agent_id', agentId)
            .eq('status', 'pending_validation');
            
        if (pendingError) throw pendingError;
        
        // Performances des 7 derniers jours
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        
        const { data: weeklyStats, error: weeklyError } = await supabase
            .from('billets')
            .select('created_at, amount, payout_amount')
            .eq('agent_id', agentId)
            .gte('created_at', sevenDaysAgo.toISOString())
            .order('created_at', { ascending: true });
            
        if (weeklyError) throw weeklyError;
        
        // Grouper par jour
        const dailyStats = {};
        (weeklyStats || []).forEach(billet => {
            const date = billet.created_at.split('T')[0];
            if (!dailyStats[date]) {
                dailyStats[date] = { sales: 0, payout: 0, count: 0 };
            }
            dailyStats[date].sales += billet.amount || 0;
            dailyStats[date].payout += billet.payout_amount || 0;
            dailyStats[date].count += 1;
        });
        
        res.json({
            success: true,
            agent: {
                id: agent.id,
                username: agent.username,
                full_name: agent.full_name,
                email: agent.email,
                phone: agent.phone,
                commission_rate: agent.commission_rate,
                ticket_limit: agent.ticket_limit,
                sous_systeme_name: agent.sous_systemes?.name
            },
            stats: {
                today: {
                    billets_count: (todayBillets || []).length,
                    sales: todaySales,
                    payout: todayPayout,
                    profit: todayProfit,
                    commission: todayProfit * (agent.commission_rate || 0.1)
                },
                pending_validation: pendingBillets?.[0]?.count || 0,
                daily_stats: dailyStats
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

// Créer un nouveau billet
app.post('/api/agent/billets', authenticateToken, requireRole('agent'), async (req, res) => {
    try {
        const agentId = req.user.sub;
        const subsystemId = req.user.subsystem_id;
        
        const { 
            ticket_number, 
            game_type, 
            amount, 
            numbers, 
            draw_date,
            client_name,
            client_phone
        } = req.body;
        
        // Validation
        if (!ticket_number || !game_type || !amount || !numbers) {
            return res.status(400).json({ 
                success: false, 
                error: 'Numéro de billet, type de jeu, montant et numéros sont requis' 
            });
        }
        
        // Vérifier si le billet existe déjà
        const { count: existingCount } = await supabase
            .from('billets')
            .select('*', { count: 'exact', head: true })
            .eq('ticket_number', ticket_number)
            .eq('subsystem_id', subsystemId);
            
        if (existingCount > 0) {
            return res.status(400).json({ 
                success: false, 
                error: 'Ce numéro de billet existe déjà' 
            });
        }
        
        // Calculer le payout selon le type de jeu
        const payoutAmount = calculatePayout(game_type, amount);
        
        // Créer le billet
        const { data: billet, error: billetError } = await supabase
            .from('billets')
            .insert({
                ticket_number: ticket_number,
                game_type: game_type,
                amount: parseFloat(amount),
                payout_amount: payoutAmount,
                numbers: numbers,
                draw_date: draw_date || new Date().toISOString().split('T')[0],
                client_name: client_name,
                client_phone: client_phone,
                agent_id: agentId,
                subsystem_id: subsystemId,
                status: 'pending_validation'
            })
            .select()
            .single();
            
        if (billetError) throw billetError;
        
        // Mettre à jour les statistiques du sous-système
        await updateSousSystemeStats(subsystemId, parseFloat(amount));
        
        res.json({
            success: true,
            message: 'Billet créé avec succès',
            billet: billet
        });
        
    } catch (error) {
        console.error('Erreur création billet:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Erreur serveur' 
        });
    }
});

// Liste des billets de l'agent
app.get('/api/agent/billets', authenticateToken, requireRole('agent'), async (req, res) => {
    try {
        const agentId = req.user.sub;
        const { 
            page = 1, 
            limit = 20, 
            status,
            start_date,
            end_date,
            game_type
        } = req.query;
        
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const from = (pageNum - 1) * limitNum;
        
        let query = supabase
            .from('billets')
            .select('*', { count: 'exact' })
            .eq('agent_id', agentId);
            
        // Appliquer les filtres
        if (status) {
            query = query.eq('status', status);
        }
        
        if (game_type) {
            query = query.eq('game_type', game_type);
        }
        
        if (start_date) {
            query = query.gte('created_at', start_date + 'T00:00:00');
        }
        
        if (end_date) {
            query = query.lte('created_at', end_date + 'T23:59:59');
        }
        
        const { data, error, count } = await query
            .order('created_at', { ascending: false })
            .range(from, from + limitNum - 1);
            
        if (error) throw error;
        
        // Calculer les totaux
        const totals = (data || []).reduce((acc, billet) => {
            acc.total_amount += billet.amount || 0;
            acc.total_payout += billet.payout_amount || 0;
            acc.total_profit += (billet.amount || 0) - (billet.payout_amount || 0);
            return acc;
        }, { total_amount: 0, total_payout: 0, total_profit: 0 });
        
        res.json({
            success: true,
            billets: data || [],
            totals: totals,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total: count,
                total_pages: Math.ceil(count / limitNum)
            }
        });
        
    } catch (error) {
        console.error('Erreur récupération billets:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Erreur serveur' 
        });
    }
});

// ============================================
// ROUTES SUPERVISEUR NIVEAU 1
// ============================================

// Billets en attente de validation
app.get('/api/supervisor/level1/pending', authenticateToken, requireSupervisorLevel(1), async (req, res) => {
    try {
        const subsystemId = req.user.subsystem_id;
        
        const { data: billets, error } = await supabase
            .from('billets')
            .select(`
                *,
                agents(full_name, username),
                clients(name, phone)
            `)
            .eq('subsystem_id', subsystemId)
            .eq('status', 'pending_validation')
            .order('created_at', { ascending: true });
            
        if (error) throw error;
        
        res.json({
            success: true,
            pending_billets: billets || []
        });
        
    } catch (error) {
        console.error('Erreur billets en attente:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Erreur serveur' 
        });
    }
});

// Valider un billet
app.put('/api/supervisor/level1/billets/:id/validate', authenticateToken, requireSupervisorLevel(1), async (req, res) => {
    try {
        const { id } = req.params;
        const { validated, rejection_reason } = req.body;
        const supervisorId = req.user.sub;
        
        // Vérifier que le billet appartient au sous-système du superviseur
        const { data: billet, error: billetError } = await supabase
            .from('billets')
            .select('subsystem_id, status')
            .eq('id', id)
            .single();
            
        if (billetError) throw billetError;
        
        if (billet.subsystem_id !== req.user.subsystem_id) {
            return res.status(403).json({ 
                success: false, 
                error: 'Billet non autorisé' 
            });
        }
        
        if (billet.status !== 'pending_validation') {
            return res.status(400).json({ 
                success: false, 
                error: 'Billet déjà traité' 
            });
        }
        
        // Mettre à jour le billet
        const updateData = {
            status: validated ? 'validated' : 'rejected',
            validated_by: supervisorId,
            validated_at: new Date().toISOString()
        };
        
        if (!validated && rejection_reason) {
            updateData.rejection_reason = rejection_reason;
        }
        
        const { data: updatedBillet, error: updateError } = await supabase
            .from('billets')
            .update(updateData)
            .eq('id', id)
            .select()
            .single();
            
        if (updateError) throw updateError;
        
        res.json({
            success: true,
            message: validated ? 'Billet validé' : 'Billet rejeté',
            billet: updatedBillet
        });
        
    } catch (error) {
        console.error('Erreur validation billet:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Erreur serveur' 
        });
    }
});

// Statistiques de validation
app.get('/api/supervisor/level1/stats', authenticateToken, requireSupervisorLevel(1), async (req, res) => {
    try {
        const subsystemId = req.user.subsystem_id;
        const today = new Date().toISOString().split('T')[0];
        
        // Billets validés aujourd'hui
        const { data: validatedToday, error: valError } = await supabase
            .from('billets')
            .select('amount')
            .eq('subsystem_id', subsystemId)
            .eq('status', 'validated')
            .gte('validated_at', today + 'T00:00:00')
            .lte('validated_at', today + 'T23:59:59');
            
        if (valError) throw valError;
        
        // Billets rejetés aujourd'hui
        const { data: rejectedToday, error: rejError } = await supabase
            .from('billets')
            .select('amount')
            .eq('subsystem_id', subsystemId)
            .eq('status', 'rejected')
            .gte('validated_at', today + 'T00:00:00')
            .lte('validated_at', today + 'T23:59:59');
            
        if (rejError) throw rejError;
        
        // En attente
        const { count: pendingCount } = await supabase
            .from('billets')
            .select('*', { count: 'exact', head: true })
            .eq('subsystem_id', subsystemId)
            .eq('status', 'pending_validation');
            
        // Performances par agent
        const { data: agentPerformance, error: perfError } = await supabase
            .from('billets')
            .select(`
                agent_id,
                agents(full_name),
                status,
                amount
            `)
            .eq('subsystem_id', subsystemId)
            .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());
            
        if (perfError) throw perfError;
        
        // Grouper par agent
        const agentsMap = {};
        (agentPerformance || []).forEach(billet => {
            const agentId = billet.agent_id;
            if (!agentsMap[agentId]) {
                agentsMap[agentId] = {
                    agent_name: billet.agents?.full_name || 'Inconnu',
                    total_billets: 0,
                    validated: 0,
                    rejected: 0,
                    pending: 0,
                    total_amount: 0
                };
            }
            
            agentsMap[agentId].total_billets++;
            agentsMap[agentId].total_amount += billet.amount || 0;
            
            if (billet.status === 'validated') {
                agentsMap[agentId].validated++;
            } else if (billet.status === 'rejected') {
                agentsMap[agentId].rejected++;
            } else if (billet.status === 'pending_validation') {
                agentsMap[agentId].pending++;
            }
        });
        
        const agentsPerformance = Object.values(agentsMap);
        
        res.json({
            success: true,
            stats: {
                today: {
                    validated: {
                        count: validatedToday?.length || 0,
                        amount: (validatedToday || []).reduce((sum, t) => sum + (t.amount || 0), 0)
                    },
                    rejected: {
                        count: rejectedToday?.length || 0,
                        amount: (rejectedToday || []).reduce((sum, t) => sum + (t.amount || 0), 0)
                    }
                },
                pending_count: pendingCount || 0,
                agents_performance: agentsPerformance
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
        const subsystemId = req.user.subsystem_id;
        
        // Statistiques générales
        const { data: sous_systeme, error: subsError } = await supabase
            .from('sous_systemes')
            .select('*, stats:statistiques_sous_systeme(*)')
            .eq('id', subsystemId)
            .single();
            
        if (subsError) throw subsError;
        
        // Performances des agents
        const { data: agents, error: agentsError } = await supabase
            .from('agents')
            .select(`
                id,
                full_name,
                username,
                commission_rate,
                ticket_limit,
                is_active
            `)
            .eq('subsystem_id', subsystemId)
            .eq('is_active', true);
            
        if (agentsError) throw agentsError;
        
        // Récupérer les performances des agents
        const agentsWithPerformance = await Promise.all(
            (agents || []).map(async (agent) => {
                const today = new Date().toISOString().split('T')[0];
                
                const { data: todayBillets, error: todayError } = await supabase
                    .from('billets')
                    .select('amount, payout_amount')
                    .eq('agent_id', agent.id)
                    .eq('status', 'validated')
                    .gte('created_at', today + 'T00:00:00')
                    .lte('created_at', today + 'T23:59:59');
                    
                if (todayError) throw todayError;
                
                const todaySales = (todayBillets || []).reduce((sum, t) => sum + (t.amount || 0), 0);
                const todayCommission = (todayBillets || []).reduce((sum, t) => {
                    const profit = (t.amount || 0) - (t.payout_amount || 0);
                    return sum + (profit * (agent.commission_rate || 0.1));
                }, 0);
                
                // Total du mois
                const startOfMonth = new Date();
                startOfMonth.setDate(1);
                startOfMonth.setHours(0, 0, 0, 0);
                
                const { data: monthBillets, error: monthError } = await supabase
                    .from('billets')
                    .select('amount')
                    .eq('agent_id', agent.id)
                    .eq('status', 'validated')
                    .gte('created_at', startOfMonth.toISOString());
                    
                if (monthError) throw monthError;
                
                const monthSales = (monthBillets || []).reduce((sum, t) => sum + (t.amount || 0), 0);
                
                return {
                    ...agent,
                    performance: {
                        today_sales: todaySales,
                        today_commission: todayCommission,
                        month_sales: monthSales,
                        today_billets: (todayBillets || []).length
                    }
                };
            })
        );
        
        // Tendance des ventes des 30 derniers jours
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        
        const { data: dailySales, error: salesError } = await supabase
            .from('billets')
            .select('created_at, amount')
            .eq('subsystem_id', subsystemId)
            .eq('status', 'validated')
            .gte('created_at', thirtyDaysAgo.toISOString())
            .order('created_at', { ascending: true });
            
        if (salesError) throw salesError;
        
        // Grouper par jour
        const salesTrend = {};
        (dailySales || []).forEach(billet => {
            const date = billet.created_at.split('T')[0];
            if (!salesTrend[date]) {
                salesTrend[date] = 0;
            }
            salesTrend[date] += billet.amount || 0;
        });
        
        res.json({
            success: true,
            sous_systeme: {
                name: sous_systeme.name,
                subdomain: sous_systeme.subdomain,
                stats: sous_systeme.stats
            },
            agents: agentsWithPerformance,
            sales_trend: salesTrend,
            summary: {
                total_agents: agents?.length || 0,
                active_agents: agentsWithPerformance.filter(a => a.is_active).length,
                total_today_sales: agentsWithPerformance.reduce((sum, a) => sum + a.performance.today_sales, 0),
                total_month_sales: agentsWithPerformance.reduce((sum, a) => sum + a.performance.month_sales, 0)
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
        const subsystemId = req.user.subsystem_id;
        
        const { data: agents, error } = await supabase
            .from('agents')
            .select('*')
            .eq('subsystem_id', subsystemId)
            .order('created_at', { ascending: false });
            
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
        const subsystemId = req.user.subsystem_id;
        
        const { 
            username, 
            full_name, 
            email, 
            phone, 
            commission_rate = 0.1,
            ticket_limit = 100
        } = req.body;
        
        if (!username || !full_name) {
            return res.status(400).json({ 
                success: false, 
                error: 'Nom d\'utilisateur et nom complet sont requis' 
            });
        }
        
        // Vérifier si l'utilisateur existe déjà
        const { count: existingCount } = await supabase
            .from('agents')
            .select('*', { count: 'exact', head: true })
            .eq('username', username)
            .eq('subsystem_id', subsystemId);
            
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
                username: username,
                password_hash: passwordHash,
                full_name: full_name,
                email: email,
                phone: phone,
                commission_rate: commission_rate,
                ticket_limit: ticket_limit,
                subsystem_id: subsystemId,
                is_active: true
            })
            .select()
            .single();
            
        if (agentError) throw agentError;
        
        // Mettre à jour les statistiques du sous-système
        await updateSousSystemeStats(subsystemId, 0, 1);
        
        res.json({
            success: true,
            message: 'Agent créé avec succès',
            agent: agent,
            temp_password: tempPassword
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
        const subsystemId = req.user.subsystem_id;
        const { 
            report_type = 'daily',
            start_date = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            end_date = new Date().toISOString().split('T')[0]
        } = req.query;
        
        let reportData;
        
        if (report_type === 'daily') {
            // Rapport quotidien
            const { data: dailyBillets, error: dailyError } = await supabase
                .from('billets')
                .select(`
                    *,
                    agents(full_name),
                    clients(name)
                `)
                .eq('subsystem_id', subsystemId)
                .eq('status', 'validated')
                .gte('created_at', start_date + 'T00:00:00')
                .lte('created_at', end_date + 'T23:59:59')
                .order('created_at', { ascending: false });
                
            if (dailyError) throw dailyError;
            
            // Grouper par jour et par agent
            const dailySummary = {};
            const agentSummary = {};
            
            (dailyBillets || []).forEach(billet => {
                const date = billet.created_at.split('T')[0];
                const agentId = billet.agent_id;
                const agentName = billet.agents?.full_name || 'Inconnu';
                
                // Daily summary
                if (!dailySummary[date]) {
                    dailySummary[date] = {
                        date: date,
                        billets: 0,
                        sales: 0,
                        payout: 0,
                        profit: 0
                    };
                }
                dailySummary[date].billets += 1;
                dailySummary[date].sales += billet.amount || 0;
                dailySummary[date].payout += billet.payout_amount || 0;
                dailySummary[date].profit += (billet.amount || 0) - (billet.payout_amount || 0);
                
                // Agent summary
                if (!agentSummary[agentId]) {
                    agentSummary[agentId] = {
                        agent_id: agentId,
                        agent_name: agentName,
                        billets: 0,
                        sales: 0,
                        payout: 0,
                        profit: 0,
                        commission: 0
                    };
                }
                agentSummary[agentId].billets += 1;
                agentSummary[agentId].sales += billet.amount || 0;
                agentSummary[agentId].payout += billet.payout_amount || 0;
                const profit = (billet.amount || 0) - (billet.payout_amount || 0);
                agentSummary[agentId].profit += profit;
                
                // Trouver le taux de commission de l'agent
                const agentCommissionRate = 0.1; // Par défaut
                agentSummary[agentId].commission += profit * agentCommissionRate;
            });
            
            reportData = {
                daily_summary: Object.values(dailySummary),
                agent_summary: Object.values(agentSummary),
                total_billets: (dailyBillets || []).length,
                total_sales: Object.values(dailySummary).reduce((sum, day) => sum + day.sales, 0),
                total_profit: Object.values(dailySummary).reduce((sum, day) => sum + day.profit, 0)
            };
            
        } else if (report_type === 'game_type') {
            // Rapport par type de jeu
            const { data: billets, error: billetsError } = await supabase
                .from('billets')
                .select('game_type, amount, payout_amount')
                .eq('subsystem_id', subsystemId)
                .eq('status', 'validated')
                .gte('created_at', start_date + 'T00:00:00')
                .lte('created_at', end_date + 'T23:59:59');
                
            if (billetsError) throw billetsError;
            
            const gameTypeSummary = {};
            
            (billets || []).forEach(billet => {
                const gameType = billet.game_type;
                if (!gameTypeSummary[gameType]) {
                    gameTypeSummary[gameType] = {
                        game_type: gameType,
                        billets: 0,
                        sales: 0,
                        payout: 0,
                        profit: 0
                    };
                }
                gameTypeSummary[gameType].billets += 1;
                gameTypeSummary[gameType].sales += billet.amount || 0;
                gameTypeSummary[gameType].payout += billet.payout_amount || 0;
                gameTypeSummary[gameType].profit += (billet.amount || 0) - (billet.payout_amount || 0);
            });
            
            reportData = {
                game_type_summary: Object.values(gameTypeSummary)
            };
        }
        
        res.json({
            success: true,
            report: reportData
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
        const subsystemId = req.user.subsystem_id;
        
        // Informations du sous-système
        const { data: sous_systeme, error: subsError } = await supabase
            .from('sous_systemes')
            .select(`
                *,
                stats:statistiques_sous_systeme(*)
            `)
            .eq('id', subsystemId)
            .single();
            
        if (subsError) throw subsError;
        
        // Statistiques détaillées
        const today = new Date().toISOString().split('T')[0];
        
        // Billets d'aujourd'hui
        const { data: todayBillets, error: todayError } = await supabase
            .from('billets')
            .select('amount, payout_amount, status')
            .eq('subsystem_id', subsystemId)
            .gte('created_at', today + 'T00:00:00')
            .lte('created_at', today + 'T23:59:59');
            
        if (todayError) throw todayError;
        
        const todaySales = (todayBillets || []).reduce((sum, t) => sum + (t.amount || 0), 0);
        const todayPayout = (todayBillets || []).reduce((sum, t) => sum + (t.payout_amount || 0), 0);
        const todayProfit = todaySales - todayPayout;
        
        // Utilisateurs
        const { data: agents, error: agentsError } = await supabase
            .from('agents')
            .select('id, is_active')
            .eq('subsystem_id', subsystemId);
            
        const { data: superviseurs, error: supersError } = await supabase
            .from('superviseurs')
            .select('id, is_active')
            .eq('subsystem_id', subsystemId);
            
        if (agentsError) throw agentsError;
        if (supersError) throw supersError;
        
        const activeAgents = (agents || []).filter(a => a.is_active).length;
        const activeSuperviseurs = (superviseurs || []).filter(s => s.is_active).length;
        
        // Performance des 7 derniers jours
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        
        const { data: weeklyBillets, error: weeklyError } = await supabase
            .from('billets')
            .select('created_at, amount, payout_amount')
            .eq('subsystem_id', subsystemId)
            .eq('status', 'validated')
            .gte('created_at', sevenDaysAgo.toISOString())
            .order('created_at', { ascending: true });
            
        if (weeklyError) throw weeklyError;
        
        // Grouper par jour
        const weeklyStats = {};
        (weeklyBillets || []).forEach(billet => {
            const date = billet.created_at.split('T')[0];
            if (!weeklyStats[date]) {
                weeklyStats[date] = { sales: 0, profit: 0, billets: 0 };
            }
            weeklyStats[date].sales += billet.amount || 0;
            weeklyStats[date].profit += (billet.amount || 0) - (billet.payout_amount || 0);
            weeklyStats[date].billets += 1;
        });
        
        // Meilleurs agents du mois
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);
        
        const { data: topAgents, error: topError } = await supabase
            .from('billets')
            .select(`
                agent_id,
                agents(full_name),
                amount
            `)
            .eq('subsystem_id', subsystemId)
            .eq('status', 'validated')
            .gte('created_at', startOfMonth.toISOString())
            .order('amount', { ascending: false })
            .limit(5);
            
        if (topError) throw topError;
        
        // Grouper par agent
        const agentSales = {};
        (topAgents || []).forEach(billet => {
            const agentId = billet.agent_id;
            const agentName = billet.agents?.full_name || 'Inconnu';
            
            if (!agentSales[agentId]) {
                agentSales[agentId] = {
                    agent_id: agentId,
                    agent_name: agentName,
                    sales: 0
                };
            }
            agentSales[agentId].sales += billet.amount || 0;
        });
        
        const topPerformers = Object.values(agentSales)
            .sort((a, b) => b.sales - a.sales)
            .slice(0, 5);
        
        res.json({
            success: true,
            sous_systeme: sous_systeme,
            stats: {
                today: {
                    billets: (todayBillets || []).length,
                    sales: todaySales,
                    payout: todayPayout,
                    profit: todayProfit
                },
                users: {
                    total_agents: agents?.length || 0,
                    active_agents: activeAgents,
                    total_superviseurs: superviseurs?.length || 0,
                    active_superviseurs: activeSuperviseurs,
                    usage_percentage: sous_systeme.stats?.usage_percentage || 0
                },
                weekly_stats: weeklyStats,
                top_performers: topPerformers
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
        const subsystemId = req.user.subsystem_id;
        const { user_type } = req.query; // 'agents', 'superviseurs', 'all'
        
        let users = [];
        
        if (!user_type || user_type === 'agents' || user_type === 'all') {
            const { data: agents, error: agentsError } = await supabase
                .from('agents')
                .select('*')
                .eq('subsystem_id', subsystemId)
                .order('created_at', { ascending: false });
                
            if (agentsError) throw agentsError;
            
            users = users.concat((agents || []).map(agent => ({
                ...agent,
                user_type: 'agent'
            })));
        }
        
        if (!user_type || user_type === 'superviseurs' || user_type === 'all') {
            const { data: superviseurs, error: supersError } = await supabase
                .from('superviseurs')
                .select('*')
                .eq('subsystem_id', subsystemId)
                .order('created_at', { ascending: false });
                
            if (supersError) throw supersError;
            
            users = users.concat((superviseurs || []).map(superviseur => ({
                ...superviseur,
                user_type: 'superviseur'
            })));
        }
        
        res.json({
            success: true,
            users: users
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
        const { user_type, is_active } = req.body; // user_type: 'agent' ou 'superviseur'
        
        if (!user_type) {
            return res.status(400).json({ 
                success: false, 
                error: 'Type d\'utilisateur requis' 
            });
        }
        
        let tableName;
        if (user_type === 'agent') {
            tableName = 'agents';
        } else if (user_type === 'superviseur') {
            tableName = 'superviseurs';
        } else {
            return res.status(400).json({ 
                success: false, 
                error: 'Type d\'utilisateur invalide' 
            });
        }
        
        // Vérifier que l'utilisateur appartient au sous-système
        const { data: user, error: userError } = await supabase
            .from(tableName)
            .select('subsystem_id')
            .eq('id', id)
            .single();
            
        if (userError) throw userError;
        
        if (user.subsystem_id !== req.user.subsystem_id) {
            return res.status(403).json({ 
                success: false, 
                error: 'Utilisateur non autorisé' 
            });
        }
        
        // Mettre à jour le statut
        const { data: updatedUser, error: updateError } = await supabase
            .from(tableName)
            .update({ 
                is_active: is_active !== undefined ? is_active : !user.is_active,
                updated_at: new Date().toISOString()
            })
            .eq('id', id)
            .select()
            .single();
            
        if (updateError) throw updateError;
        
        // Mettre à jour les statistiques du sous-système
        const { data: stats } = await supabase
            .from('statistiques_sous_systeme')
            .select('active_users')
            .eq('subsystem_id', req.user.subsystem_id)
            .single();
            
        if (stats) {
            const newActiveUsers = is_active ? 
                Math.min(stats.active_users + 1, stats.max_users || 10) : 
                Math.max(stats.active_users - 1, 0);
                
            const usagePercentage = Math.round((newActiveUsers / (stats.max_users || 10)) * 100);
            
            await supabase
                .from('statistiques_sous_systeme')
                .update({
                    active_users: newActiveUsers,
                    usage_percentage: usagePercentage,
                    updated_at: new Date().toISOString()
                })
                .eq('subsystem_id', req.user.subsystem_id);
        }
        
        res.json({
            success: true,
            message: `Utilisateur ${is_active ? 'activé' : 'désactivé'} avec succès`,
            user: updatedUser
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
        const subsystemId = req.user.subsystem_id;
        const updates = req.body;
        
        // N'autoriser que certains champs à être modifiés
        const allowedUpdates = [
            'contact_email', 'contact_phone', 'max_users'
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
        
        const { data: updatedSousSysteme, error } = await supabase
            .from('sous_systemes')
            .update(filteredUpdates)
            .eq('id', subsystemId)
            .select()
            .single();
            
        if (error) throw error;
        
        res.json({
            success: true,
            message: 'Paramètres mis à jour',
            sous_systeme: updatedSousSysteme
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
                tableName = 'admins_sous_systeme';
                break;
            case 'master':
                tableName = 'utilisateurs_maitre';
                break;
            default:
                return res.status(400).json({ 
                    success: false, 
                    error: 'Rôle invalide' 
                });
        }
        
        // Récupérer l'utilisateur
        const { data: user, error: userError } = await supabase
            .from(tableName)
            .select('password_hash')
            .eq('id', userId)
            .single();
            
        if (userError) throw userError;
        
        // Vérifier le mot de passe actuel
        const currentHash = Buffer.from(current_password + 'nova-lotto-salt').toString('base64');
        if (user.password_hash !== currentHash) {
            return res.status(401).json({ 
                success: false, 
                error: 'Mot de passe actuel incorrect' 
            });
        }
        
        // Mettre à jour avec le nouveau mot de passe
        const newHash = Buffer.from(new_password + 'nova-lotto-salt').toString('base64');
        
        const { error: updateError } = await supabase
            .from(tableName)
            .update({ 
                password_hash: newHash,
                updated_at: new Date().toISOString()
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
                selectFields = '*, sous_systemes(name, subdomain)';
                break;
            case 'supervisor':
                tableName = 'superviseurs';
                selectFields = '*, sous_systemes(name, subdomain)';
                break;
            case 'subsystem_admin':
                tableName = 'admins_sous_systeme';
                selectFields = '*, sous_systemes(name, subdomain)';
                break;
            case 'master':
                tableName = 'utilisateurs_maitre';
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
        
        // Masquer le hash du mot de passe
        const { password_hash, ...safeUser } = user;
        
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

// Mettre à jour le profil
app.put('/api/user/profile', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.sub;
        const userRole = req.user.role;
        const updates = req.body;
        
        // N'autoriser que certains champs
        const allowedUpdates = [
            'full_name', 'email', 'phone'
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
                tableName = 'admins_sous_systeme';
                break;
            case 'master':
                tableName = 'utilisateurs_maitre';
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
                updated_at: new Date().toISOString()
            })
            .eq('id', userId)
            .select()
            .single();
            
        if (error) throw error;
        
        // Masquer le hash du mot de passe
        const { password_hash, ...safeUser } = updatedUser;
        
        res.json({
            success: true,
            message: 'Profil mis à jour',
            profile: safeUser
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
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklopqrstuvwxyz0123456789!@#$%^&*';
    let password = '';
    for (let i = 0; i < length; i++) {
        password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
}

// Calculer le payout selon le type de jeu
function calculatePayout(gameType, amount) {
    const multipliers = {
        'borlette': 70,
        'lotto-3': 500,
        'lotto-4': 5000,
        'lotto-5': 75000,
        'grap': 7,
        'marriage': 35
    };
    
    const multiplier = multipliers[gameType] || 1;
    return parseFloat(amount) * multiplier;
}

// Mettre à jour les statistiques du sous-système
async function updateSousSystemeStats(sousSystemeId, amount = 0, userChange = 0) {
    try {
        const today = new Date().toISOString().split('T')[0];
        
        // Récupérer les statistiques actuelles
        const { data: stats, error: statsError } = await supabase
            .from('statistiques_sous_systeme')
            .select('*')
            .eq('sous_systeme_id', sousSystemeId)
            .single();
            
        if (statsError && statsError.code === 'PGRST116') {
            // Pas encore de statistiques, les créer
            await supabase
                .from('statistiques_sous_systeme')
                .insert({
                    sous_systeme_id: sousSystemeId,
                    active_users: Math.max(userChange, 0),
                    today_billets: amount > 0 ? 1 : 0,
                    today_sales: amount,
                    total_billets: amount > 0 ? 1 : 0,
                    total_sales: amount,
                    usage_percentage: 0,
                    updated_at: new Date().toISOString()
                });
            return;
        }
        
        if (statsError) throw statsError;
        
        // Mettre à jour les statistiques
        const updates = {
            updated_at: new Date().toISOString()
        };
        
        // Vérifier si c'est un nouveau jour
        const lastUpdated = new Date(stats.updated_at);
        const todayDate = new Date();
        
        if (lastUpdated.toISOString().split('T')[0] !== today) {
            // Réinitialiser les stats du jour
            updates.today_billets = amount > 0 ? 1 : 0;
            updates.today_sales = amount;
        } else {
            // Ajouter aux stats du jour
            updates.today_billets = (stats.today_billets || 0) + (amount > 0 ? 1 : 0);
            updates.today_sales = (stats.today_sales || 0) + amount;
        }
        
        // Mettre à jour les totaux
        updates.total_billets = (stats.total_billets || 0) + (amount > 0 ? 1 : 0);
        updates.total_sales = (stats.total_sales || 0) + amount;
        
        // Mettre à jour les utilisateurs actifs
        if (userChange !== 0) {
            const newActiveUsers = Math.max((stats.active_users || 0) + userChange, 0);
            updates.active_users = newActiveUsers;
            
            // Récupérer le nombre max d'utilisateurs
            const { data: sous_systeme } = await supabase
                .from('sous_systemes')
                .select('max_users')
                .eq('id', sousSystemeId)
                .single();
                
            if (sous_systeme) {
                updates.usage_percentage = Math.round((newActiveUsers / sous_systeme.max_users) * 100);
            }
        }
        
        await supabase
            .from('statistiques_sous_systeme')
            .update(updates)
            .eq('sous_systeme_id', sousSystemeId);
            
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
const express = require('express' );
const https = require('https');
const fs = require('fs');
const socketIo = require('socket.io');
const path = require('path');
const { PeerServer } = require('peer');

// Initialisation de l'application
const app = express();

// Configuration des certificats pour la prise en compte du https
const options = {
    key: fs.readFileSync('certificats/localhost-key.pem'),
    cert: fs.readFileSync('certificats/localhost.pem' )
};

// Configuration du serveur HTTPS
const server = https.createServer(options, app);
const io = socketIo(server);

// Configuration du serveur PeerJS
const peerServer = PeerServer({
    port: 9000,
    path: '/myapp' ,
    ssl: options
});

// Configuration du moteur de template ejs
app. set('view engine', 'ejs');
app. set('views', path. join(__dirname, 'views'));
app. use(express.static(path.join( __dirname, 'public')));

app. use(express. json());
app. use(express. urlencoded({ extended: true }));

// Variables globales pour gérer les réunions
const reunions = new Map() ;
const utilisateurs = new Map() ;

// Configuration des routes d’accès à l’application
app.get('/', (req, res) => {
    res.render('index', {
        title: 'Accueil - Application de Réunion'
    });
});

// Route pour créer une réunion
app.post('/creer-reunion', (req, res) => {
    const { nomUtilisateur } = req.body;
    const idReunion = genererIdReunion();

    // Créer une nouvelle réunion
    reunions.set(idReunion, {
        id: idReunion,
        createur: nomUtilisateur,
        participants:[],
        partageEcran: null,
        dateCreation: new Date()
    });

    res.redirect(`/reunion/${idReunion}?nom=${encodeURIComponent(nomUtilisateur)}`);
});

app.post('/rejoindre-reunion', (req, res) => {
    const { idReunion, nomUtilisateur } = req.body;

    if (reunions.has(idReunion)) {
        res.redirect(`/reunion/${idReunion}?nom=${encodeURIComponent(nomUtilisateur)}`);
    } else {
        res.render( 'index', {
            title: 'Accueil - Application de Réunion',
            erreur: 'Reunion introuvable'
        });
    }
});

app.get('/reunion/:id', (req, res) => {
    const idReunion = req.params.id;
    const nomUtilisateur = req.query.nom;

    if (!reunions.has(idReunion)) {
        return res.redirect('/?erreur=reunion-introuvable');
    }

    res.render( 'reunion', {
        title: `Réunion ${idReunion}`,
        idReunion,
        nomUtilisateur,
        reunion: reunions.get(idReunion)
    });
});

// Gestion des connexions Socket.IO
io.on('connection', (socket) => {
    console. log('Nouvelle connexion: ', socket.id);

    // Rejoindre une réunion
    socket. on('rejoindre-reunion', (data) => {
        const { idReunion, nomUtilisateur, peerId } = data;

        if (reunions.has(idReunion)) {
            const reunion = reunions. get(idReunion);

            // Ajouter l'utilisateur
            const utilisateur = {
                id: socket.id,
                peerId,
                nom: nomUtilisateur,
                audioActive: true,
                videoActive: true,
                idReunion: idReunion, // Ajout pour la gestion des déconnexions
                mainLevee: false // Nouveau statut pour 'Lever la Main'
            };

            reunion. participants. push(utilisateur);
            utilisateurs.set(socket.id, utilisateur);

            // Rejoindre la room Socket.IO
            socket. join(idReunion);

            // Notifier les autres participants
            socket. to(idReunion). emit('nouvel-utilisateur', {
                peerId,
                nom: nomUtilisateur
            });

            // Envoyer la liste des participants existants
            const participantsExistants = reunion. participants
               .filter(p => p.id!== socket.id)
               .map(p => ({ peerId: p.peerId, nom: p.nom }));

            socket. emit('participants-existants', participantsExistants);

            // Mettre a jour la liste des participants pour tous
            io. to(idReunion). emit('mise-a-jour-participants',
                reunion. participants.map(p => ({
                    nom: p.nom,
                    audioActive: p.audioActive,
                    videoActive: p.videoActive,
                    mainLevee: p.mainLevee 
                }))
            );
        }
    });

    // Gestion de la fonctionnalité "Lever la Main" 
    socket.on('lever-la-main', (data) => {
        const { idReunion, statut } = data;
        const utilisateur = utilisateurs.get(socket.id);
        
        if (utilisateur && reunions.has(idReunion)) {
            utilisateur.mainLevee = statut;
            
            // Notification rapide aux autres participants
            socket.to(idReunion).emit('statut-main-levee-change', {
                peerId: utilisateur.peerId,
                statut: statut,
                nom: utilisateur.nom
            });
            
            // Mettre à jour la liste complète pour la synchronisation
            const reunion = reunions.get(idReunion);
            io.to(idReunion).emit('mise-a-jour-participants',
                reunion.participants.map(p => ({
                    nom: p.nom,
                    audioActive: p.audioActive,
                    videoActive: p.videoActive,
                    mainLevee: p.mainLevee
                }))
            );
        }
    });

    // Gestion de la signalisation d'enregistrement 
    socket.on('demarrer-enregistrement', (data) => {
        const utilisateur = utilisateurs.get(socket.id);
        if (utilisateur) {
            socket.to(data.idReunion).emit('enregistrement-demarre', { nom: utilisateur.nom });
        }
    });

    socket.on('arreter-enregistrement', (data) => {
        const utilisateur = utilisateurs.get(socket.id);
        if (utilisateur) {
            socket.to(data.idReunion).emit('enregistrement-arrete', { nom: utilisateur.nom });
        }
    });

    // Gestion du partage d'écran
    socket. on('commencer-partage-ecran', (data) => {
        const { idReunion } = data;
        const utilisateur = utilisateurs.get(socket.id);

        if (reunions.has(idReunion) && utilisateur) {
            const reunion = reunions. get(idReunion);
            reunion. partageEcran = {
                utilisateur: utilisateur.nom,
                peerId: utilisateur.peerId
            };

            io.to(idReunion). emit('partage-ecran-commence', {
                utilisateur: utilisateur.nom,
                peerId: utilisateur.peerId
            });
        }
    });

    socket. on('arreter-partage-ecran', (data) => {
        const { idReunion } = data;

        if (reunions.has(idReunion)) {
            const reunion = reunions. get(idReunion);
            reunion. partageEcran = null;

            io.to(idReunion). emit('partage-ecran-arrete');
        }
    });

    // Gestion des flux audio/vidéo
    socket. on( 'basculer-audio', (data) => {
        const { idReunion, audioActive } = data;
        const utilisateur = utilisateurs.get(socket.id);

        if (utilisateur) {
            utilisateur.audioActive = audioActive;
            socket. to(idReunion). emit('utilisateur-audio-change', {
                peerId: utilisateur.peerId,
                audioActive
            });
        }
    });

    socket. on('basculer-video', (data) => {
        const { idReunion, videoActive } = data;
        const utilisateur = utilisateurs.get(socket.id);

        if (utilisateur) {
            utilisateur. videoActive = videoActive;
            socket. to(idReunion). emit('utilisateur-video-change', {
                peerId: utilisateur.peerId,
                videoActive
            });
        }
    });

    // Déconnexion
    socket. on( 'disconnect', () => {
        const utilisateur = utilisateurs.get(socket.id);

        if (utilisateur) {
            // Utiliser idReunion de l'objet utilisateur pour cibler directement
            const idReunion = utilisateur.idReunion; 

            if (reunions.has(idReunion)) { 
                const reunion = reunions.get(idReunion);
                
                // Retirer l'utilisateur de la réunion
                const index = reunion. participants. findIndex(p => p.id === socket.id);
                if (index!== -1) {
                    reunion. participants. splice(index, 1);
                    
                    // Notifier les autres participants
                    socket.to(idReunion). emit('utilisateur-deconnecte', {
                        peerId: utilisateur.peerId
                    });
                    
                    // Mettre à jour la liste des participants
                    io.to(idReunion). emit('mise-a-jour-participants',
                        reunion. participants. map(p => ({
                            nom: p.nom,
                            audioActive: p.audioActive,
                            videoActive: p.videoActive,
                            mainLevee: p.mainLevee 
                        }))
                    );
                    
                    // Supprimer la réunion si vide
                    if (reunion.participants. length === 0) {
                        reunions.delete(idReunion);
                    }
                }
            }

            // Supprimer l'utilisateur de la map globale
            utilisateurs.delete(socket.id);
        }
    });
});

// Fonction utilitaire pour générer un ID de réunion
function genererIdReunion() {
    return Math.random(). toString(36). substring(2, 8). toUpperCase();
}

// Démarrage du serveur
const PORT = process. env. PORT || 3000;
server. listen(PORT, '0.0.0.0', () => {
    console. log(`Serveur demarre sur https://localhost : ${PORT}`);
    console. log('Serveur PeerJS demarre sur port 9000');
});

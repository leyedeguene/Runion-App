// =================================================================
// Configuration Globale
// =================================================================
let socket;
let peer;
let monStreamLocal;
let streamPartageEcran;
let connexionsPeers = new Map(); // Key: PeerID distant, Value: PeerJS Call Object
let participantsDistants = new Map(); // Key: PeerID distant, Value: { nom: string, audioActif: boolean, videoActif: boolean, mainLevee: boolean }

let audioActif = true;
let videoActif = true;
let partageEcranActif = false;
let mainLeveeActive = false;
let enregistrementActif = false;
let mediaRecorder; // Objet MediaRecorder pour l'enregistrement
const CHUNK_SIZE = 10; // Taille du morceau pour l'enregistrement

// =================================================================
// Fonctions Utilitaires
// =================================================================

/**
 * Affiche un message de statut temporaire (Toast).
 * @param {string} message - Le message à afficher.
 */
function afficherMessageStatut(message) {
    const messageStatutDiv = document.getElementById('messageStatut');
    messageStatutDiv.textContent = message;
    messageStatutDiv.style.display = 'block';

    setTimeout(() => {
        messageStatutDiv.style.display = 'none';
    }, 4000);
}

// =================================================================
// Initialisation de l'Application et des Médias
// =================================================================

/**
 * Fonction principale d'initialisation.
 * @param {string} idReunion - ID de la réunion actuelle.
 * @param {string} nomUtilisateur - Nom de l'utilisateur local.
 */
async function initialiserReunion(idReunion, nomUtilisateur) {
    // 1. Initialiser Socket.IO
    socket = io();

    // 2. Tenter d'obtenir le flux média local (audio et vidéo)
    try {
        monStreamLocal = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: true
        });

        // Afficher le flux local dans la petite fenêtre
        const monVideoElement = document.getElementById('monVideo');
        monVideoElement.srcObject = monStreamLocal;

        // Mettre à jour l'icône audio/vidéo
        monVideoElement.addEventListener('loadedmetadata', () => {
            mettreAJourStatutAudioLocal(audioActif);
        });

        // 3. Initialiser PeerJS et joindre la réunion
        initialiserPeer(idReunion, nomUtilisateur);

    } catch (err) {
        console.error("Erreur d'accès aux médias :", err);
        afficherMessageStatut("Erreur : Impossible d'accéder à la caméra/micro. Vérifiez les permissions.");
        
        // Continuer sans médias si impossible (pour permettre de rejoindre en "muet")
        initialiserPeer(idReunion, nomUtilisateur); 
    }

    // 4. Configurer les événements du DOM
    configurerEvenementsDOM(idReunion);

    // 5. Configurer les événements Socket.IO
    configurerEvenementsSocket(idReunion);
}

/**
 * Initialise l'objet PeerJS et gère les connexions.
 * @param {string} idReunion - ID de la réunion actuelle.
 * @param {string} nomUtilisateur - Nom de l'utilisateur local.
 */
function initialiserPeer(idReunion, nomUtilisateur) {
    // Le 'host' de l'application est utilisé par défaut, le port 9000 et le path '/myapp' pour PeerServer
    peer = new Peer(undefined, {
        host: '/', 
        port: 9000, 
        path: '/myapp',
        secure: true // Utiliser SSL car le serveur Express est en HTTPS
    });

    peer.on('open', (peerId) => {
        console.log('PeerJS ouvert. ID: ' + peerId);
        
        // 4. Émettre l'événement de jonction une fois que PeerJS est prêt
        socket.emit('rejoindre-reunion', {
            idReunion,
            nomUtilisateur,
            peerId
        });
    });

    // 5. Gérer les appels entrants d'autres utilisateurs
    peer.on('call', (call) => {
        // Répondre à l'appel avec notre flux local (peut être null si erreur media)
        call.answer(monStreamLocal); 
        
        // Attendre le flux distant et l'afficher
        call.on('stream', (streamDistant) => {
            ajouterStreamDistant(call.peer, streamDistant);
        });
        
        // Stocker la connexion
        connexionsPeers.set(call.peer, call);
        
        call.on('close', () => {
            retirerVideoDistante(call.peer);
        });
    });

    peer.on('error', (err) => {
        console.error('Erreur PeerJS:', err);
        afficherMessageStatut(`Erreur PeerJS: ${err.type}`);
    });
}

/**
 * Appelle tous les participants existants de la réunion.
 * @param {Array<{peerId: string, nom: string}>} participantsExistants 
 */
function connecterAuxParticipants(participantsExistants) {
    participantsExistants.forEach(p => {
        const call = peer.call(p.peerId, monStreamLocal); 
        connexionsPeers.set(p.peerId, call);
        
        call.on('stream', (streamDistant) => {
            ajouterStreamDistant(p.peerId, streamDistant, p.nom);
        });
        
        call.on('close', () => {
            retirerVideoDistante(p.peerId);
        });
    });
}

// =================================================================
// Gestion des Vidéos et Affichage
// =================================================================

/**
 * Crée un élément vidéo pour un participant distant.
 * @param {string} peerId - ID PeerJS du participant.
 * @param {MediaStream} stream - Le flux média distant.
 * @param {string} [nomUtilisateur] - Nom de l'utilisateur (optionnel, utilisé à la connexion).
 */
function ajouterStreamDistant(peerId, stream, nomUtilisateur = 'Inconnu') {
    if (document.getElementById(`video-${peerId}`)) {
        return; // Vidéo déjà ajoutée
    }

    // Créer le conteneur de la vidéo
    const videoContainer = document.createElement('div');
    videoContainer.classList.add('video-distante');
    videoContainer.id = `container-${peerId}`;

    // Créer l'élément vidéo
    const videoElement = document.createElement('video');
    videoElement.id = `video-${peerId}`;
    videoElement.srcObject = stream;
    videoElement.autoplay = true;
    
    // Créer la zone de libellé
    const labelDiv = document.createElement('div');
    labelDiv.classList.add('video-local-label'); // Réutiliser le style de label
    labelDiv.id = `label-${peerId}`;
    
    const nomSpan = document.createElement('span');
    nomSpan.textContent = participantsDistants.has(peerId) ? participantsDistants.get(peerId).nom : nomUtilisateur;
    nomSpan.id = `nom-distant-${peerId}`;
    
    const statutAudio = document.createElement('div');
    statutAudio.id = `statut-audio-${peerId}`;
    statutAudio.classList.add('status-icon', 'mute-red'); // Par défaut on affiche muet ou actif

    labelDiv.appendChild(nomSpan);
    labelDiv.appendChild(statutAudio);
    
    videoContainer.appendChild(videoElement);
    videoContainer.appendChild(labelDiv);
    
    // Ajouter au conteneur principal
    const videosConteneur = document.getElementById('videosDistantes');
    videosConteneur.appendChild(videoContainer);
    
    // Si c'est le premier participant, le mettre en plein écran au lieu de l'avatar central
    if (videosConteneur.querySelectorAll('.video-distante').length === 1) {
        document.querySelector('.video-placeholder').style.display = 'none';
        videoContainer.style.position = 'static';
        videoContainer.style.width = '100%';
        videoContainer.style.height = '100%';
        videoContainer.querySelector('video').style.width = '100%';
        videoContainer.querySelector('video').style.height = '100%';
        videosConteneur.style.display = 'flex';
        videosConteneur.style.flexWrap = 'wrap';
        videosConteneur.style.gap = '10px';
    }
}

/**
 * Retire un élément vidéo distant du DOM.
 * @param {string} peerId - ID PeerJS du participant.
 */
function retirerVideoDistante(peerId) {
    const videoContainer = document.getElementById(`container-${peerId}`);
    if (videoContainer) {
        videoContainer.remove();
        participantsDistants.delete(peerId);
        connexionsPeers.delete(peerId);
    }
    
    // Si toutes les vidéos sont retirées, réafficher l'avatar central
    const videosConteneur = document.getElementById('videosDistantes');
    if (videosConteneur.querySelectorAll('.video-distante').length === 0) {
        document.querySelector('.video-placeholder').style.display = 'flex';
    }
}

/**
 * Met à jour l'état de l'icône audio de l'utilisateur local.
 * @param {boolean} actif - Vrai si l'audio est actif, faux sinon.
 */
function mettreAJourStatutAudioLocal(actif) {
    const statutIcon = document.getElementById('statutAudioLocal');
    statutIcon.classList.toggle('mute-red', !actif);
    statutIcon.classList.toggle('audio-actif-green', actif);
}

/**
 * Met à jour l'état de l'icône audio d'un participant distant.
 * @param {string} peerId - ID PeerJS du participant.
 * @param {boolean} actif - Vrai si l'audio est actif, faux sinon.
 */
function mettreAJourStatutAudioDistant(peerId, actif) {
    const statutIcon = document.getElementById(`statut-audio-${peerId}`);
    if (statutIcon) {
        statutIcon.classList.toggle('mute-red', !actif);
        statutIcon.classList.toggle('audio-actif-green', actif);
    }
}

/**
 * Met à jour la liste complète des participants dans la sidebar.
 * @param {Array<{nom: string, audioActive: boolean, videoActive: boolean, mainLevee: boolean}>} participants 
 */
function mettreAJourListeParticipants(participants) {
    const listeParticipantsDiv = document.getElementById('listeParticipants');
    const participantsBadge = document.getElementById('boutonParticipants');
    listeParticipantsDiv.innerHTML = '';
    
    participantsBadge.innerHTML = `<i class="icon-participants"></i> Participants (${participants.length})`;

    participants.forEach(p => {
        const item = document.createElement('div');
        item.classList.add('participant-item');
        
        item.innerHTML = `
            <span>${p.nom}</span>
            <div class="participant-statut">
                <div class="statut-badge ${p.audioActive ? 'audio-actif' : 'audio-inactif'}"></div>
                <div class="statut-badge ${p.videoActive ? 'video-actif' : 'video-inactif'}"></div>
                ${p.mainLevee ? '<div class="statut-badge main-levee-actif">✋</div>' : ''}
            </div>
        `;
        
        listeParticipantsDiv.appendChild(item);
    });
}

// =================================================================
// Gestion des événements DOM (Boutons de contrôle)
// =================================================================

function configurerEvenementsDOM(idReunion) {
    // ------------------- Bouton Audio -------------------
    document.getElementById('boutonAudio').addEventListener('click', () => {
        if (!monStreamLocal) return; 

        audioActif = !audioActif;
        const audioTrack = monStreamLocal.getAudioTracks()[0];
        if (audioTrack) {
            audioTrack.enabled = audioActif;
        }

        // Mettre à jour l'icône
        const bouton = document.getElementById('boutonAudio');
        bouton.classList.toggle('audio-actif', audioActif);
        bouton.classList.toggle('audio-inactif', !audioActif);
        bouton.querySelector('i').classList.toggle('icon-mic-on', audioActif);
        bouton.querySelector('i').classList.toggle('icon-mic-off', !audioActif);

        // Mettre à jour l'icône locale
        mettreAJourStatutAudioLocal(audioActif);

        // Notifier les autres participants via Socket.IO
        socket.emit('basculer-audio', { idReunion, audioActive: audioActif });
    });

    // ------------------- Bouton Vidéo -------------------
    document.getElementById('boutonVideo').addEventListener('click', () => {
        if (!monStreamLocal) return;

        videoActif = !videoActif;
        const videoTrack = monStreamLocal.getVideoTracks()[0];
        if (videoTrack) {
            videoTrack.enabled = videoActif;
        }
        
        // Mettre à jour l'icône
        const bouton = document.getElementById('boutonVideo');
        bouton.classList.toggle('video-actif', videoActif);
        bouton.classList.toggle('video-inactif', !videoActif);
        bouton.querySelector('i').classList.toggle('icon-camera-on', videoActif);
        bouton.querySelector('i').classList.toggle('icon-camera-off', !videoActif);

        // Afficher/Cacher la petite vidéo locale
        document.getElementById('monVideoContainer').style.display = videoActif ? 'block' : 'none';

        // Notifier les autres participants via Socket.IO
        socket.emit('basculer-video', { idReunion, videoActive: videoActif });
    });

    // ------------------- Bouton Quitter -------------------
    document.getElementById('boutonQuitter').addEventListener('click', () => {
        // Déconnecter le socket et PeerJS
        socket.disconnect();
        peer.destroy();
        
        // Arrêter les pistes locales
        if (monStreamLocal) {
            monStreamLocal.getTracks().forEach(track => track.stop());
        }
        if (streamPartageEcran) {
            streamPartageEcran.getTracks().forEach(track => track.stop());
        }
        
        // Rediriger vers la page d'accueil
        window.location.href = '/'; 
    });
    
    // ------------------- Bouton Lever la Main (NOUVEAU) -------------------
    document.getElementById('boutonLeverLaMain').addEventListener('click', () => {
        mainLeveeActive = !mainLeveeActive;
        const bouton = document.getElementById('boutonLeverLaMain');
        
        bouton.classList.toggle('main-levee-actif', mainLeveeActive);
        
        // Notifier le serveur et les autres
        socket.emit('lever-la-main', { idReunion, statut: mainLeveeActive });
        
        afficherMessageStatut(mainLeveeActive ? "Votre main est levée." : "Votre main est baissée.");
    });
    
    // ------------------- Bouton Enregistrer (NOUVEAU) -------------------
    document.getElementById('boutonEnregistrer').addEventListener('click', () => {
        if (!monStreamLocal) {
            afficherMessageStatut("Erreur: Impossible d'enregistrer sans flux média actif.");
            return;
        }

        if (enregistrementActif) {
            arreterEnregistrement(idReunion);
        } else {
            demarrerEnregistrement(idReunion);
        }
    });

    // ------------------- Bouton Partage d'Écran (NOUVEAU) -------------------
    document.getElementById('boutonPartageEcran').addEventListener('click', () => {
        if (partageEcranActif) {
            arreterPartageEcran(idReunion);
        } else {
            demarrerPartageEcran(idReunion);
        }
    });
}

// =================================================================
// Gestion des événements Socket.IO
// =================================================================

function configurerEvenementsSocket(idReunion) {
    
    // Un nouvel utilisateur rejoint, nous devons l'appeler
    socket.on('nouvel-utilisateur', (data) => {
        console.log(`Nouvel utilisateur ${data.nom} (${data.peerId}) a rejoint.`);
        afficherMessageStatut(`${data.nom} a rejoint la réunion.`);
        
        // Établir la connexion PeerJS sortante
        const call = peer.call(data.peerId, monStreamLocal);
        connexionsPeers.set(data.peerId, call);
        
        // Attendre son flux (nécessaire si l'utilisateur rejoint sans nous appeler)
        call.on('stream', (streamDistant) => {
            ajouterStreamDistant(data.peerId, streamDistant, data.nom);
        });
    });

    // Le serveur nous envoie la liste des participants existants pour les appeler
    socket.on('participants-existants', (participants) => {
        connecterAuxParticipants(participants);
    });

    // Un utilisateur se déconnecte, on retire sa vidéo
    socket.on('utilisateur-deconnecte', (data) => {
        console.log(`Utilisateur ${data.peerId} déconnecté.`);
        retirerVideoDistante(data.peerId);
        
        // Afficher un message de déconnexion (le nom est dans participantsDistants)
        const nom = participantsDistants.has(data.peerId) ? participantsDistants.get(data.peerId).nom : 'Un utilisateur';
        afficherMessageStatut(`${nom} a quitté la réunion.`);
    });
    
    // Mise à jour de l'état audio d'un participant distant
    socket.on('utilisateur-audio-change', (data) => {
        mettreAJourStatutAudioDistant(data.peerId, data.audioActive);
    });
    
    // Mise à jour de l'état vidéo d'un participant distant
    socket.on('utilisateur-video-change', (data) => {
        const videoElement = document.getElementById(`video-${data.peerId}`);
        if (videoElement) {
            videoElement.style.visibility = data.videoActive ? 'visible' : 'hidden';
            // Vous pourriez aussi ajouter un overlay avec l'avatar
        }
    });

    // Mise à jour de la liste complète des participants (audio/vidéo/main-levée)
    socket.on('mise-a-jour-participants', (participants) => {
        // Mettre à jour la map locale des participants distants pour les noms/statuts
        participantsDistants.clear();
        participants.forEach(p => {
            // Identifier l'utilisateur local (ici on utilise le nom comme clé, c'est peu fiable)
            // L'idéal serait d'utiliser l'ID PeerJS dans la structure du participant sur le serveur.
            // Pour l'instant, on se base sur la liste fournie et on met à jour la sidebar.
            
            // Si vous aviez l'ID Peer dans la structure, on pourrait:
            // if (p.peerId !== peer.id) participantsDistants.set(p.peerId, p);
        });
        
        mettreAJourListeParticipants(participants);
    });
    
    // Notification de main levée
    socket.on('statut-main-levee-change', (data) => {
        if (data.statut) {
            afficherMessageStatut(`${data.nom} a levé la main! ✋`);
        }
        // La mise à jour de la liste complète par 'mise-a-jour-participants' fera le reste
    });

    // Notifications d'enregistrement (Nouveau)
    socket.on('enregistrement-demarre', (data) => {
        afficherMessageStatut(`🔴 Enregistrement démarré par ${data.nom}.`);
    });

    socket.on('enregistrement-arrete', (data) => {
        afficherMessageStatut(`◼️ Enregistrement arrêté par ${data.nom}.`);
    });

    // ------------------- Partage d'Écran -------------------
    socket.on('partage-ecran-commence', (data) => {
        if (data.peerId !== peer.id) {
            afficherMessageStatut(`${data.utilisateur} commence le partage d'écran.`);
            
            // Option 1: Reconnecter PeerJS pour obtenir le flux de partage
            // (La logique PeerJS pour gérer le partage est souvent complexe, 
            // ici on simplifie en n'appelant que l'utilisateur local pour le partage)
            
            // Alternative: Demander à l'utilisateur qui partage de nous rappeler avec le stream de partage.
        }
    });

    socket.on('partage-ecran-arrete', () => {
        afficherMessageStatut("Le partage d'écran est terminé.");
        
        // Option 2: Masquer la vidéo de partage et réafficher la grille normale
        document.getElementById('partageEcranContainer').style.display = 'none';
        document.getElementById('videosDistantes').style.display = 'flex';
    });
}

// =================================================================
// Gestion des Fonctionnalités Avancées (Partage d'écran et Enregistrement)
// =================================================================

/**
 * Démarre l'enregistrement du flux local.
 * @param {string} idReunion - ID de la réunion actuelle.
 */
function demarrerEnregistrement(idReunion) {
    try {
        const options = { mimeType: 'video/webm; codecs=vp9' };
        const chunks = [];
        mediaRecorder = new MediaRecorder(monStreamLocal, options);

        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                chunks.push(event.data);
            }
        };

        mediaRecorder.onstop = () => {
            const blob = new Blob(chunks, { type: 'video/webm' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = `reunion_enregistrement_${Date.now()}.webm`;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => {
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }, 100);
            
            // Réinitialiser
            chunks.length = 0;
        };
        
        mediaRecorder.start(CHUNK_SIZE * 1000); // Enregistrer par morceaux de 10 secondes
        enregistrementActif = true;
        document.getElementById('boutonEnregistrer').classList.add('enregistrement-actif');
        
        socket.emit('demarrer-enregistrement', { idReunion });
        afficherMessageStatut("🔴 Enregistrement démarré.");

    } catch (err) {
        console.error("Erreur lors du démarrage de l'enregistrement:", err);
        afficherMessageStatut("Erreur: Impossible de démarrer l'enregistrement.");
    }
}

/**
 * Arrête l'enregistrement et télécharge le fichier.
 * @param {string} idReunion - ID de la réunion actuelle.
 */
function arreterEnregistrement(idReunion) {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
        enregistrementActif = false;
        document.getElementById('boutonEnregistrer').classList.remove('enregistrement-actif');
        socket.emit('arreter-enregistrement', { idReunion });
        afficherMessageStatut("◼️ Enregistrement terminé. Téléchargement en cours.");
    }
}

/**
 * Démarre la capture et le partage de l'écran.
 * @param {string} idReunion - ID de la réunion actuelle.
 */
async function demarrerPartageEcran(idReunion) {
    if (partageEcranActif) return;

    try {
        // Demander à l'utilisateur de sélectionner l'écran/fenêtre à partager
        streamPartageEcran = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: true 
        });

        // 1. Remplacer le flux vidéo local dans tous les appels PeerJS actifs
        const videoTrack = streamPartageEcran.getVideoTracks()[0];
        
        connexionsPeers.forEach(call => {
            // Trouver la bonne piste à remplacer (généralement la première piste vidéo)
            const sender = call.peerConnection.getSenders().find(s => s.track.kind === 'video');
            if (sender) {
                sender.replaceTrack(videoTrack);
            }
        });

        // 2. Afficher le partage d'écran localement
        const videoPartageEcran = document.getElementById('videoPartageEcran');
        videoPartageEcran.srcObject = streamPartageEcran;
        document.getElementById('partageEcranContainer').style.display = 'block';
        document.getElementById('monVideoContainer').style.display = 'none'; // Cacher la petite vidéo locale
        document.querySelector('.video-placeholder').style.display = 'none';
        
        // Cacher les autres vidéos distantes pour le focus sur l'écran partagé
        document.querySelectorAll('.video-distante').forEach(container => container.style.display = 'none');


        // 3. Gérer l'arrêt du partage via le bouton du navigateur
        videoTrack.onended = () => {
            arreterPartageEcran(idReunion);
        };

        // 4. Mettre à jour le statut et notifier le serveur
        partageEcranActif = true;
        document.getElementById('boutonPartageEcran').classList.add('video-actif'); // Style actif
        socket.emit('commencer-partage-ecran', { idReunion });
        afficherMessageStatut("Partage d'écran démarré.");

    } catch (err) {
        console.error("Erreur lors de la capture d'écran:", err);
        afficherMessageStatut("Partage d'écran annulé ou impossible.");
    }
}

/**
 * Arrête le partage de l'écran et restaure la caméra locale.
 * @param {string} idReunion - ID de la réunion actuelle.
 */
function arreterPartageEcran(idReunion) {
    if (!partageEcranActif) return;

    // 1. Arrêter les pistes du stream de partage
    streamPartageEcran.getTracks().forEach(track => track.stop());
    streamPartageEcran = null;

    // 2. Restaurer le flux vidéo de la caméra locale dans tous les appels
    const cameraTrack = monStreamLocal.getVideoTracks()[0];
    
    connexionsPeers.forEach(call => {
        const sender = call.peerConnection.getSenders().find(s => s.track.kind === 'video');
        if (sender && cameraTrack) {
            sender.replaceTrack(cameraTrack);
        }
    });

    // 3. Masquer la vidéo de partage et restaurer la vidéo locale
    document.getElementById('partageEcranContainer').style.display = 'none';
    if (videoActif) {
        document.getElementById('monVideoContainer').style.display = 'block';
    }
    
    // Restaurer l'affichage des vidéos distantes
    document.querySelectorAll('.video-distante').forEach(container => container.style.display = 'block');
    if (document.querySelectorAll('.video-distante').length === 0) {
        document.querySelector('.video-placeholder').style.display = 'flex';
    }
    
    // 4. Mettre à jour le statut et notifier le serveur
    partageEcranActif = false;
    document.getElementById('boutonPartageEcran').classList.remove('video-actif');
    socket.emit('arreter-partage-ecran', { idReunion });
    afficherMessageStatut("Partage d'écran arrêté.");
}

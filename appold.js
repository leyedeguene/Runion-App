let socket;
let peer;
let monStreamLocal;
let streamPartageEcran;
let connexionsPeers = new Map() ;
let audioActif = true;
let videoActif = true;
let partageEcranActif = false;
let mainLeveeActive = false; // Nouveau statut pour 'Lever la Main' [2]
let mediaRecorder; // Objet MediaRecorder pour l'enregistrement [3]
let enregistrementChunks =; // Tableau pour stocker les fragments de données [4]
let enregistrementActif = false; // Statut de l'enregistrement [4]

let monVideo;
let videosDistantes;
let listeParticipants;
let boutonAudio;
let boutonVideo;
let boutonPartageEcran;
let boutonQuitter;
let messageStatut;
let videoPartageEcran;
let partageEcranContainer;
let boutonLeverLaMain; // Nouveau bouton pour 'Lever la Main' [2]
let boutonEnregistrer; // Nouveau bouton pour l'enregistrement [4]

function initialiserReunion(idReunion, nomUtilisateur) {
console. log('Initialisation de la reunion: ', idReunion, nomUtilisateur);

// Obtenir les references aux elements DOM
obtenirElementsDOM();

// Configurer les gestionnaires d'événements
configurerGestionnaires();

// Initialiser Socket.IO
initialiserSocket();

// Initialiser PeerJS
initialiserPeer(idReunion, nomUtilisateur);

// Obtenir le stream local (video/audio)
obtenirStreamLocal();
}

function obtenirElementsDOM() {
monVideo = document.getElementById('monVideo');
videosDistantes = document.getElementById('videosDistantes');
listeParticipants = document.getElementById('listeParticipants');
boutonAudio = document. getElementById('boutonAudio' );
boutonVideo = document. getElementById('boutonVideo');
boutonPartageEcran = document.getElementById('boutonPartageEcran');
boutonQuitter = document. getElementById('boutonQuitter' );
messageStatut = document. getElementById('messageStatut');
videoPartageEcran = document.getElementById('videoPartageEcran');
partageEcranContainer = document.getElementById('partageEcranContainer' );
boutonLeverLaMain = document.getElementById('boutonLeverLaMain'); // Ajout [2]
boutonEnregistrer = document.getElementById('boutonEnregistrer'); // Ajout [4]
}

function configurerGestionnaires() {
// Gestionnaire pour le bouton audio
boutonAudio. addEventListener('click', function() {
audioActif =!audioActif;

if (monStreamLocal) {
const pistesAudio = monStreamLocal. getAudioTracks();
pistesAudio. forEach(piste => piste. enabled = audioActif);
}

mettreAJourBoutonAudio();
socket. emit('basculer-audio', {
idReunion: window. idReunionGlobal,
audioActive: audioActif
});
});

// Gestionnaire pour le bouton vidéo
boutonVideo. addEventListener('click', function() {
videoActif =!videoActif;

if (monStreamLocal) {
const pistesVideo = monStreamLocal.getVideoTracks();
pistesVideo. forEach(piste => piste. enabled = videoActif);
}

mettreAJourBoutonVideo();
socket. emit('basculer-video', {
idReunion: window. idReunionGlobal,
videoActive: videoActif
});
});

// Gestionnaire pour le partage d'écran
boutonPartageEcran.addEventListener('click', function() {
if (partageEcranActif) {
arreterPartageEcran();
} else {
commencerPartageEcran();
}
});

// Gestionnaire pour le bouton 'Lever la Main' (Nouveau)
boutonLeverLaMain.addEventListener('click', function() { // [2]
    mainLeveeActive =!mainLeveeActive;
    mettreAJourBoutonLeverLaMain();
    socket.emit('lever-la-main', {
        idReunion: window.idReunionGlobal,
        statut: mainLeveeActive
    });
});

// Gestionnaire pour le bouton 'Enregistrer' (Nouveau)
boutonEnregistrer.addEventListener('click', function() { // [4]
    if (enregistrementActif) {
        arreterEnregistrement();
    } else {
        demarrerEnregistrement();
    }
});

// Gestionnaire pour quitter
boutonQuitter. addEventListener('click', function() {
if (confirm('Etes-vous sûr de vouloir quitter la réunion?')) {
window. location.href = '/';
}
});
}

function initialiserSocket() {
socket = io();

// Gestionnaire pour un nouvel utilisateur
socket. on('nouvel-utilisateur', function(data) {
console. log('Nouvel utilisateur connecté : ', data);
afficherMessage(`${data. nom} a rejoint la reunion`); // Correction: Utilisation des anti-quotes (\`...\`)

// Appeler le nouvel utilisateur
setTimeout(() => {
appellerUtilisateur(data.peerId, data.nom);
}, 1000);
});


// Gestionnaire pour les participants existants
socket. on('participants-existants', function(participants) {
console. log('Participants existants: ', participants);

participants. forEach(participant => {
setTimeout(() => {
appellerUtilisateur(participant.peerId, participant.nom);
}, 1000);
});
});

// Gestionnaire pour la mise à jour des participants 
socket. on('mise-a-jour-participants', function(participants) {
mettreAJourListeParticipants(participants);
});

// Gestionnaire pour la déconnexion d'un utilisateur 
socket. on('utilisateur-deconnecte', function(data) {
console. log('Utilisateur déconnecté: ', data);

// Fermer la connexion peer
if (connexionsPeers.has(data.peerId)) {
connexionsPeers.get(data.peerId). close();
connexionsPeers.delete(data.peerId);
}

// Retirer la vidéo de l'interface
const videoElement = document. getElementById(`video-${data. peerId}`); // Correction: Utilisation des anti-quotes (\`...\`)
if (videoElement) {
videoElement.remove();
}

afficherMessage('Un participant a quitté la réunion');
});

// Gestionnaires pour le partage d'écran 
socket. on('partage-ecran-commence', function(data) {
afficherMessage(`${data.utilisateur} partage son écran`); // Correction: Utilisation des anti-quotes (\`...\`)
});

socket. on('partage-ecran-arrete', function() {
afficherMessage('Le partage d\'ecran s\'est arrêté'); // Correction: Utilisation des anti-quotes (\`...\`)
masquerPartageEcran();
});

// Gestionnaire pour le changement de statut 'Lever la Main' (Nouveau)
socket. on('statut-main-levee-change', function(data) { // [2]
    console. log('Changement de statut main levée: ', data);
    // La mise à jour visuelle est gérée principalement par 'mise-a-jour-participants' pour la liste.
    if (data.statut) {
        afficherMessage(`${data.nom} a levé la main.`);
    }
});

// Gestionnaires pour la signalisation d'enregistrement (Nouveau)
socket. on('enregistrement-demarre', function(data) { // [2]
    afficherMessage(`${data.nom} a démarré l'enregistrement.`);
});

socket. on('enregistrement-arrete', function(data) { // [2]
    afficherMessage(`${data.nom} a arrêté l'enregistrement.`);
});

// Gestionnaires pour les changements audio/vidéo
socket. on('utilisateur-audio-change ', function (data) {
console. log('Changement audio utilisateur: ', data);
// Logique de mise à jour visuelle du statut audio
});

socket. on('utilisateur-video-change', function(data) {
console. log('Changement vidéo utilisateur: ', data);
// Logique de mise à jour visuelle du statut vidéo
});
}

function initialiserPeer(idReunion, nomUtilisateur) {
// Créer une instance PeerJS
peer = new Peer(undefined, {
host: window.location.hostname, // Correction: Utilisation de window.location.hostname pour la portabilité
port: 9000,
path: '/myapp' ,
secure: true
});

// Quand le peer est prêt
peer. on('open', function (peerId) {
console. log('PeerJS connecte avec ID: ', peerId);

// Sauvegarder l'ID de reunion globalement
window. idReunionGlobal = idReunion;

// Rejoindre la réunion via Socket.IO
socket. emit('rejoindre-reunion', {
idReunion: idReunion,
nomUtilisateur: nomUtilisateur,
peerId: peerId
});
});

// Gestionnaire pour les appels entrants
peer. on('call', function(appel) {
console. log('Appel entrant de: ', appel. peer);

// Repondre avec notre stream local
appel. answer(monStreamLocal);

// Gerer le stream de l'appelant
appel. on('stream', function(streamDistant) {
ajouterVideoDistante(appel.peer, streamDistant);
});

// Sauvegarder la connexion
connexionsPeers. set(appel.peer, appel);

// Gerer la fermeture de l'appel
appel. on('close', function() {
console. log('Appel fermé avec: ', appel. peer);
retirerVideoDistante(appel.peer);
});
});

// Gestionnaire d'erreurs
peer. on('error', function(erreur) {
console. error('Erreur PeerJS: ', erreur);
afficherMessage(`Erreur de connexion: ${erreur.message}`); // Correction: Utilisation des anti-quotes (\`...\`)
});
}

function obtenirStreamLocal() {
navigator.mediaDevices.getUserMedia({
video: true,
audio: true
})
.then(function(stream) {
monStreamLocal = stream;
monVideo.srcObject = stream;

console. log('Stream local obtenu');

// Mettre à jour les boutons initiaux
mettreAJourBoutonAudio();
mettreAJourBoutonVideo();
mettreAJourBoutonLeverLaMain();

})
.catch(function(erreur) {
console.error('Erreur lors de l'obtention du stream local: ', erreur);
afficherMessage('Impossible d\'acceder a la camera/microphone' );
});
}

function appellerUtilisateur(peerId, nom) {
console. log('Appel vers: ', peerId, nom);

if (!monStreamLocal) {
console. log('Stream local pas encore pret, reessai dans 1 seconde');
setTimeout(() => appellerUtilisateur(peerId, nom), 1000);
return;
}

// Faire l'appel
const appel = peer. call(peerId, monStreamLocal);

// Gérer le stream de réponse
appel. on('stream', function(streamDistant) {
ajouterVideoDistante(peerId, streamDistant, nom);
});

// Sauvegarder la connexion
connexionsPeers. set(peerId, appel);

// Gérer la fermeture
appel.on('close', function() {
console. log('Appel ferme avec: ', peerId);
retirerVideoDistante(peerId);
});

// Gerer les erreurs
appel.on('error', function(erreur) {
console. error('Erreur lors de l\'appel: ', erreur);
});
}

function ajouterVideoDistante(peerId, stream, nom = 'Participant') {
console. log('Ajout video distante pour: ', peerId);

// Vérifier si la vidéo existe déjà
let videoContainer = document.getElementById(`video-${peerId}`); // Correction: Utilisation des anti-quotes (\`...\`)

if (!videoContainer) {
// Créer le conteneur vidéo
videoContainer = document. createElement('div');
videoContainer.id = `video-${peerId}`; // Correction: Utilisation des anti-quotes (\`...\`)
videoContainer.className = 'video-distante';

// Créer l'élément vidéo
const videoElement = document. createElement('video');
videoElement.autoplay = true;
videoElement.srcObject = stream;

// Creer le label
const label = document. createElement('div');
label.className = 'video-label';
label.textContent = nom;

// Assembler
videoContainer.appendChild(videoElement);
videoContainer. appendChild(label);

// Ajouter au conteneur
videosDistantes. appendChild(videoContainer);
} else {
// Mettre à jour le stream existant
const videoElement = videoContainer. querySelector('video');
videoElement.srcObject = stream;
}
}

function retirerVideoDistante(peerId) {
const videoContainer = document.getElementById(`video-${peerId}`); // Correction: Utilisation des anti-quotes (\`...\`)
if (videoContainer) {
videoContainer.remove();
}
}

function commencerPartageEcran() {
navigator.mediaDevices.getDisplayMedia({
video: true,
audio: true
})
.then(function(stream) {
streamPartageEcran = stream;

// Afficher le partage d'écran localement
videoPartageEcran. srcObject = stream;
partageEcranContainer. style. display = 'block';

partageEcranActif = true;
boutonPartageEcran. textContent = 'Arrêter le Partage' ;

// Notifier les autres participants
socket. emit('commencer-partage-ecran', {
idReunion: window. idReunionGlobal
});

// Partager avec tous les participants connectés
connexionsPeers. forEach((connexion, peerId) => {
// Remplacer le track vidéo par celui du partage d'écran
const sender = connexion. peerConnection.getSenders(). find(s =>
s.track && s.track.kind === 'video'
);

if (sender) {
sender.replaceTrack(stream.getVideoTracks() );
}
});


// Gestion de l'arrêt du partage d'écran (bouton du navigateur)
stream. getVideoTracks() . onended = function() {
arreterPartageEcran();
};

afficherMessage('Partage d\'ecran démarré' );
})
.catch(function(erreur) {
console. error('Erreur partage d\'ecran: ', erreur);
afficherMessage('Impossible de partager l\'écran');
});
}

function arreterPartageEcran() {
if (streamPartageEcran) {
streamPartageEcran.getTracks(). forEach(track => track. stop());
streamPartageEcran = null;
}

partageEcranContainer.style.display = 'none';
partageEcranActif = false;
boutonPartageEcran. textContent = 'Partager l\'Écran';

// Remettre la caméra
if (monStreamLocal) {
connexionsPeers. forEach((connexion, peerId) => {
const sender = connexion. peerConnection. getSenders(). find(s =>
s.track && s.track.kind === 'video'
);

if (sender && monStreamLocal.getVideoTracks() ) {
sender.replaceTrack(monStreamLocal. getVideoTracks() );
}
});
}

// Notifier les autres participants
socket. emit('arreter-partage-ecran', {
idReunion: window. idReunionGlobal
});

afficherMessage('Partage d\'ecran arrêté');
}

function masquerPartageEcran() {
partageEcranContainer.style.display = 'none';
}

function mettreAJourBoutonAudio() {
if (audioActif) {
boutonAudio.textContent = 'Audio Activé' ;
boutonAudio. className = 'bouton controle audio-actif' ;
} else {
boutonAudio. textContent = 'Audio Coupé' ;
boutonAudio. className = 'bouton controle audio-inactif' ;
}
}

function mettreAJourBoutonVideo() {
if (videoActif) {
boutonVideo. textContent = 'Vidéo Activee' ;
boutonVideo. className = 'bouton controle video-actif';
} else {
boutonVideo. textContent = 'Vidéo Coupée' ;
boutonVideo. className = 'bouton controle video-inactif';
}
}

// Nouvelle fonction de mise à jour du bouton 'Lever la Main' (Nouveau)
function mettreAJourBoutonLeverLaMain() { // [2]
    if (mainLeveeActive) {
        boutonLeverLaMain.textContent = 'Main Levée (X)';
        boutonLeverLaMain.className = 'bouton controle main-levee-actif';
    } else {
        boutonLeverLaMain.textContent = 'Lever la Main';
        boutonLeverLaMain.className = 'bouton controle';
    }
}
=
function mettreAJourListeParticipants(participants) {
listeParticipants. innerHTML = '';

participants. forEach(participant => {
const item = document. createElement('div');
item. className = 'participant-item';

const nom = document. createElement('span');
nom. className = 'participant-nom';
nom. textContent = participant.nom;

const statut = document. createElement('div');
statut.className = 'participant-statut' ;

// Badge audio
const badgeAudio = document. createElement('div');
badgeAudio.className = `statut-badge ${participant. audioActive? 'audio-actif' : 'audio-inactif'}`; // Correction: Utilisation des anti-quotes (\`...\`)
badgeAudio.title = participant.audioActive? 'Audio activé' : 'Audio coupé' ;

// Badge vidéo
const badgeVideo = document. createElement('div');
badgeVideo. className = `statut-badge ${participant. videoActive? 'video-actif' : 'video-inactif'}`; // Correction: Utilisation des anti-quotes (\`...\`)
badgeVideo.title = participant. videoActive? 'Vidéo activée' : 'Vidéo coupée' ;

statut. appendChild(badgeAudio);
statut. appendChild(badgeVideo);

// Badge Main Levée (Nouveau)
if (participant.mainLevee) { // [2]
    const badgeMainLevee = document.createElement('div');
    badgeMainLevee.className = 'statut-badge main-levee-actif';
    badgeMainLevee.title = 'Main levée';
    statut.appendChild(badgeMainLevee);
}

item.appendChild(nom);
item. appendChild(statut);

listeParticipants.appendChild(item);
});
}

function afficherMessage(message) {
messageStatut.textContent = message;
messageStatut.style.display = 'block';

setTimeout(function() {
messageStatut.style.display = 'none';
}, 3000);
}

// Fonction pour démarrer l'enregistrement (Nouveau)
function demarrerEnregistrement() { // [3]
    if (!monStreamLocal) {
        afficherMessage("Erreur: Stream local non disponible pour l'enregistrement.");
        return;
    }

    // Enregistrement du flux local (audio et vidéo)
    mediaRecorder = new MediaRecorder(monStreamLocal, { mimeType: 'video/webm; codecs=vp8' }); // [4, 3]
    enregistrementChunks =;

    mediaRecorder.ondataavailable = function(e) { // [4]
        enregistrementChunks.push(e.data);
    };

    mediaRecorder.onstop = function() { // [5]
        const blob = new Blob(enregistrementChunks, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = `reunion_${window.idReunionGlobal}_${Date.now()}.webm`; // Nom du fichier
        document.body.appendChild(a);
        a.click();
        
        // Nettoyage après téléchargement
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 100);
        
        // Mise à jour de l'UI
        enregistrementActif = false;
        boutonEnregistrer.textContent = 'Enregistrer';
        boutonEnregistrer.className = 'bouton controle';

        // Signalisation de l'arrêt
        socket.emit('arreter-enregistrement', { idReunion: window.idReunionGlobal }); // [2]
    };

    mediaRecorder.onerror = function(e) {
        console.error("Erreur MediaRecorder:", e);
        afficherMessage("Erreur lors de l'enregistrement.");
        enregistrementActif = false;
        boutonEnregistrer.textContent = 'Enregistrer';
        boutonEnregistrer.className = 'bouton controle';
    };

    mediaRecorder.start(1000); // Enregistrer par segments [3]
    enregistrementActif = true;
    boutonEnregistrer.textContent = 'Arrêter l\'Enregistrement';
    boutonEnregistrer.className = 'bouton controle enregistrement-actif';

    // Signalisation du démarrage
    socket.emit('demarrer-enregistrement', { idReunion: window.idReunionGlobal }); // [2]

    afficherMessage('Enregistrement local démarré (sauvegardé sur votre machine).');
}

// Fonction pour arrêter l'enregistrement (Nouveau)
function arreterEnregistrement() {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
    }
}

Gestion de la fermeture de la page
```javascript
window.addEventListener('beforeunload', function() {
if (peer) {
peer. destroy();
}

if (socket) {
socket.disconnect();
}
});



const admin = require('firebase-admin')
const serviceAccount = require('./serviceAccountKey.json') //do not put this in git 

admin.initializeApp({
	credential:  admin.credential.cert(serviceAccount),
	databaseURL: "https://aux-io.firebaseio.com",
	storageBucket: "aux-io.appspot.com",
});
const db = admin.database()
const storage = admin.storage().bucket()

let roomTimerMap = {} // {roomid: timerid}
const historyFields = ['title', 'artist', 'album', 'albumURL']
main()


function main() {
	// When new room is created, add a track listener
	db.ref('rooms').on('child_added', roomData => {
		const roomId = roomData.getKey()
		db.ref(`room_data/${roomId}/current_track/duration`).on('value', duration => {
			console.log('current track duration change')
			if (!duration.exists()) return false
			const oldTimerId = roomTimerMap[roomId]
			if (oldTimerId) {
				clearTimeout(oldTimerId)
			}
			console.log('setting timer')
			roomTimerMap[roomId] = setTimeout(()=>trackEnded(roomId), duration.val() * 1000)
			return deleteCtFromQueue(roomId)
		})
	})

	// When room is deleted, remove from mapping and stop timer
	db.ref('rooms').on('child_removed', roomData => {
		const roomId = roomData.getKey()
		clearTimeout(roomTimerMap[roomId])
		delete roomTimerMap[roomId]
	})
}

//TODO: Also delete from bucket
async function trackEnded(roomId) {
	// get the track that is ending
	const ct = await getCurrentTrack(roomId)
	if (!ct) return false
	console.log('ct was not false B')
	const oldSongData = ct.val()
	const songId = oldSongData.key || null
	if (!songId) return false

	// Copy some stuff into history
	const historyData = historyFields.reduce((o, k) => {
		if (oldSongData[k]) {
			o[k] = oldSongData[k]
		}
		return o
	}, {})
	db.ref(`room_data/${roomId}/songs/history/${songId}`).set(historyData)

	// after track ends, start the next one
	const currentTrackRef = db.ref('room_data/' + roomId + '/current_track')
	getNextTrack(roomId).then(nextTrack => {
		console.log('got next track:', nextTrack)
		if (nextTrack) {
			currentTrackRef.set(nextTrack)
		} else {
			currentTrackRef.parent.child('track_playing').set(false)
			currentTrackRef.remove()
		}
	})

	// remove trace of the old song
	return deleteTrack(roomId, songId, oldSongData.name)
}

//gets the next track from song data
async function getNextTrack(roomId) {
	console.log('getting next track')
	const roomSongsObj = await db.ref('song_data/' + roomId).orderByChild('pending').equalTo(false).once('value')

	if (roomSongsObj.exists()) {
		console.log('song data exists')
		const songs = Object.entries(roomSongsObj.val())
		const numberOfSongs = songs.length
		const rand = Math.floor(Math.random() * numberOfSongs)
		const [nextTrackId, nextTrack] = songs[rand]
		const songUrlObj = await db.ref('song_urls/' + nextTrackId).once('value')

		if (songUrlObj.exists()) {
			console.log('song url exists')
			return {...nextTrack, url: songUrlObj.val(), key: nextTrackId, startedAt: Date.now() + 500}
		} else {
			// url doesn't exist for some reason so we can't play this
			console.log('url doesnt exist')
			await deleteTrack(roomId, nextTrackId)
			return getNextTrack(roomId)
		}

	}

	return false
}

// delete given song from everywhere
async function deleteTrack(roomId, songId, fileName) {
	console.log('deleting song from everywhere')
	return Promise.all([
		db.ref('room_data/' + roomId + '/songs/uploaded/' + songId).remove(), //unneeded probably 
		db.ref('room_data/' + roomId + '/songs/pending/' + songId).remove(),
		db.ref('song_urls/' + songId).remove(),
		storage.file(`songs/${fileName}`).delete(),
		db.ref(`song_data/${roomId}/${songId}`).remove(), //unneeded probably 
	])

}

async function deleteCtFromQueue(roomId) {
	console.log('deleting ct from queue')
	const ct = await getCurrentTrack(roomId)
	if (!ct) return false
	console.log('ct was not false A')
	const songId = ct.val().key
	console.log('ct key is',songId)
	return Promise.all([
		admin.database().ref('room_data/' + roomId + '/songs/uploaded/' + songId).remove(),
		admin.database().ref('song_data/' + roomId + '/' + songId).remove(),
		])
}

function getCurrentTrack(roomId){
	console.log('getting current track')
	return db.ref('room_data/' + roomId + '/current_track').once('value').then(ct => {
		return ct.exists() && ct
	})
}
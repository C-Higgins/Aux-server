const admin = require('firebase-admin')
const serviceAccount = require('./serviceAccountKey.json') //do not put this in git 

admin.initializeApp({
	credential:  admin.credential.cert(serviceAccount),
	databaseURL: "https://aux-io.firebaseio.com"
});
const db = admin.database()
const storage = admin.storage()

let roomTimerMap = {} // {roomid: timerid}
const historyFields = ['title', 'artist', 'album', 'albumURL']
main()


main = () => {
	// When new room is created, add a track listener
	db.ref('rooms').on('child_added').then(roomData => {
		const roomKey = roomData.getKey()
		db.ref(`room_data/${roomKey}/current_track/duration`).on('value').then(duration => {
			const oldTimerId = roomTimerMap[roomKey]
			if (oldTimerId) {
				clearTimeout(oldTimerId)
			}
			roomTimerMap[roomKey] = setTimeout(trackEnded(roomKey), duration.val() * 1000)
		})
	})

	// When room is deleted, remove from mapping and stop timer
	db.ref('rooms').on('child_removed').then(roomData => {
		const roomKey = roomData.getKey()
		clearTimeout(roomTimerMap[roomKey])
		delete roomTimerMap[roomKey]
	})
}

//TODO: Also delete from bucket
trackEnded = async (roomId) => {
	// get the track that is ending
	const currentTrackRef = db.ref('room_data/' + roomId + '/current_track')
	const ct = await currentTrackRef.once('value')
	const oldSongData = ct.val()
	const songId = (oldSongData && oldSongData.key) || null
	if (!songId) return false

	// Copy some stuff into history
	const historyData = historyFields.reduce((o, k) => {
		if (oldSongData[k]) {
			o[k] = oldSongData[k]
		}
		return o
	}, {})
	db.ref(`room_data/${roomId}/songs/history/${songId}`).set(historyData)

	// remove trace of the old song
	await deleteTrack(roomId, songId)

	// after track ends, start the next one
	const nextTrack = await getNextTrack(roomId)
	if (nextTrack) {
		currentTrackRef.set(nextTrack)
	} else {
		currentTrackRef.parent.child('track_playing').set(false)
		currentTrackRef.remove()
	}

}

getNextTrack = async (roomId) => {
	const roomSongsObj = await db.ref('song_data/' + roomId).orderByChild('pending').equalTo(false).once('value')

	if (roomSongsObj.exists()) {
		const songs = Object.entries(roomSongsObj.val())
		const numberOfSongs = songs.length
		const rand = Math.floor(Math.random() * numberOfSongs)
		const [nextTrackId, nextTrack] = songs[rand]
		const songUrlObj = await db.ref('song_urls/' + nextTrackId).once('value')

		if (songUrlObj.exists()) {
			return {...nextTrack, url: songUrlObj.val(), key: nextTrackId, startedAt: Date.now() + 200}
		} else {
			// url doesn't exist for some reason so we can't play this
			await deleteTrack(roomId, nextTrackId)
			return getNextTrack(roomId)
		}

	}

	return false
}

deleteTrack = (roomId, songId) => {
	return Promise.all([
		db.ref('room_data/' + roomId + '/songs/uploaded/' + songId).remove(),
		db.ref('room_data/' + roomId + '/songs/pending/' + songId).remove(),
		db.ref('song_urls/' + songId).remove(),
		storage.child(`songs/${oldSongData.name}`).delete(),
		db.ref(`song_data/${roomId}/${songId}`).remove(),
	])

}
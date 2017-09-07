const admin = require('firebase-admin')
const serviceAccount = require('./serviceAccountKey.json') //do not put this in git 

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://aux-io.firebaseio.com"
});

const db = admin.database()

db.ref('rooms/-KsOrIb7AyzUMPbc5YQS').once('value').then(data => {
	console.log(data.val())
	process.exit()
})


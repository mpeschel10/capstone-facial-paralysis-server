const SERVER_URL = 'http://127.0.0.1:17447'

import assert from 'node:assert';

import { initializeApp } from '@firebase/app';
import { initializeAuth, signInWithEmailAndPassword } from '@firebase/auth';

const firebaseConfig = {
    apiKey: 'AIzaSyA0cVD15lMtM9qYAedfKVvzDYQ6t0WizJs',
    authDomain: 'facial-analytics-f8b9e.firebaseapp.com',
    projectId: 'facial-analytics-f8b9e',
    storageBucket: 'facial-analytics-f8b9e.appspot.com',
    messagingSenderId: '1087200042336',
    appId: '1:1087200042336:web:c0c22a9037cd8b92f41205',
};
const app = initializeApp(firebaseConfig);
const auth = initializeAuth(app);

const mGreyCredential = await signInWithEmailAndPassword(auth, 'mgrey@gmail.com', 'password');
const mGreyTokenResult = await mGreyCredential.user.getIdTokenResult();
assert.deepEqual(mGreyTokenResult.claims.roles, ["a", "c"]);

const idToken = await mGreyCredential.user.getIdToken();

fetch(SERVER_URL + "/api/users", {
    method:'POST',
    body: JSON.stringify({
        "token": idToken,
        "user": {
            "email": "jdonahue@gmail.com",
            "password": "password",
            "roles": ["c"],
        }
    }),
});

const jDonahueCredential = await signInWithEmailAndPassword(auth, 'mgrey@gmail.com', 'password');
const jDonahueTokenResult = await jDonahueCredential.user.getIdTokenResult();
assert.deepEqual(jDonahueTokenResult.claims.roles, ["c"]);

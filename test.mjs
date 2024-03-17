const SERVER_URL = 'http://127.0.0.1:17447'
// const SERVER_URL = 'https://fa.mpeschel10.com'

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
console.log("Sanity test OK");

const idToken = await mGreyCredential.user.getIdToken();

async function debugFetch(url, options) {
    const response = await fetch(url, options);

    if (false) {
        console.log('Status code:', response.status);
        console.log('Response headers:', Object.fromEntries(response.headers));
        response.rawText = await response.text()
        console.log('Response body:', response.rawText);
        response.json = () => JSON.parse(response.rawText);
        console.log('');
    }
    
    return response;
}

async function cleanup() {
    await debugFetch(SERVER_URL + "/users.json",  {
        method:'DELETE',
        body: JSON.stringify({
            "token": idToken,
            "user": {
                "email": "jdonahue@gmail.com",
            }
        }),
    });
    
    await debugFetch(SERVER_URL + "/users.json",  {
        method:'DELETE',
        body: JSON.stringify({
            "token": idToken,
            "user": {
                "email": "rmyrtle@gmail.com",
            }
        }),
    });
}

async function testCreateClinician() {
    await debugFetch(SERVER_URL + "/users.json", {
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
    
    const jDonahueCredential = await signInWithEmailAndPassword(auth, 'jdonahue@gmail.com', 'password');
    const jDonahueTokenResult = await jDonahueCredential.user.getIdTokenResult();
    assert.deepEqual(jDonahueTokenResult.claims.roles, ["c"]);
    console.log("Create clinician OK");
}

const testPatientData = {
    email: "rmyrtle@gmail.com",
    displayName: "Rachel Myrtle",
    password: "password",
};

async function testCreatePatient() {
    await debugFetch(SERVER_URL + "/users.json", {
        method:'POST',
        body: JSON.stringify({
            "token": idToken,
            "user": Object.assign({
                roles: ["p"],
            }, testPatientData),
        }),
    });
    
    const rMyrtleCredential = await signInWithEmailAndPassword(auth, 'rmyrtle@gmail.com', 'password');
    const rMyrtleTokenResult = await rMyrtleCredential.user.getIdTokenResult();
    assert.deepEqual(rMyrtleTokenResult.claims.roles, ["p"]);
    console.log("Create patient OK");
}

async function testGetAccount() {
    const params = new URLSearchParams({
        token: idToken,
        email: testPatientData.email,
    });
    const requestUrl = SERVER_URL + "/users.json" + "?" + params;
    // console.log("Fetching", requestUrl);
    const response = await debugFetch(requestUrl, {
        method: 'GET',
    });
    const user = await response.json();
    assert.strictEqual(user.displayName, testPatientData.displayName);
    console.log("Get account OK");
}

function getUser(uid, email) {
    const parameters = {token: idToken};
    if (uid) parameters.uid = uid;
    else if (email) parameters.email = email;
    // console.log(parameters);
    return debugFetch(
        SERVER_URL + "/users.json" + "?" + new URLSearchParams(parameters), {
        method: 'GET',
    }).then(result => result.json());
}

async function testUpdateAccount() {
    const initialUserValue = await getUser(undefined, testPatientData.email);
    assert.strictEqual(initialUserValue.displayName, testPatientData.displayName);
    
    const newName = 'Rebecca Myrtle';
    const parameters = {
        token: idToken,
        uid: initialUserValue.uid,
    };
    const body = JSON.stringify({
        displayName: newName,
        customClaims: {roles: ['c']},
    });
    
    await debugFetch(
        SERVER_URL + "/users.json" + "?" + new URLSearchParams(parameters), {
        method: 'PUT',
        body
    });

    const finalUserValue = await getUser(initialUserValue.uid, undefined);
    // console.log(finalUserValue);
    assert.strictEqual(finalUserValue.displayName, newName);
    assert.strictEqual(finalUserValue.email, testPatientData.email);
    assert.deepStrictEqual(finalUserValue.customClaims.roles, ['c']);
    console.log("Set account OK");
}

// TODO
// Confirm it rejects expired token e.g.
// eyJhbGciOiJSUzI1NiIsImtpZCI6IjYwOWY4ZTMzN2ZjNzg1NTE0ZTExMGM2ZDg0N2Y0M2M3NDM1M2U0YWYiLCJ0eXAiOiJKV1QifQ.eyJuYW1lIjoiTWVyZWRpdGggR3JleSIsInJvbGVzIjpbImEiLCJjIl0sImlzcyI6Imh0dHBzOi8vc2VjdXJldG9rZW4uZ29vZ2xlLmNvbS9mYWNpYWwtYW5hbHl0aWNzLWY4YjllIiwiYXVkIjoiZmFjaWFsLWFuYWx5dGljcy1mOGI5ZSIsImF1dGhfdGltZSI6MTcxMDM5MDc2NiwidXNlcl9pZCI6ImdSbm5aR01EVU9PVGhIOEpkYmZ1Iiwic3ViIjoiZ1JublpHTURVT09UaEg4SmRiZnUiLCJpYXQiOjE3MTAzOTA3NjYsImV4cCI6MTcxMDM5NDM2NiwiZW1haWwiOiJtZ3JleUBnbWFpbC5jb20iLCJlbWFpbF92ZXJpZmllZCI6ZmFsc2UsImZpcmViYXNlIjp7ImlkZW50aXRpZXMiOnsiZW1haWwiOlsibWdyZXlAZ21haWwuY29tIl19LCJzaWduX2luX3Byb3ZpZGVyIjoicGFzc3dvcmQifX0.Y6-XZ1MnXjf6btAEhC1qtDSrTXnlwzka7fmcmUJvJAf6DPZv676qaCf96Bt9LajCkuj1ekptQeGoaIjcVI3RIJKvyk17wQiga6LYL34p6mJku5i9PIu7KMXmwLGzNr0j3vlZ21G4RWJr1LkcBQGtWpZXwFk46ssqV8yCy1rXzjepi9hQuivbgfc0YZU7g3JmwXHoQYSjPMeTh4wtB_h2BFoaSBf1vMzI3KuhWhdztdTpWnptmDV17jGkBYsxW5Upl0IfUBWLg2NAe-cVcZBdTpc5qQDBh-xzT__-7wCTYcUmU4bOtYJ5uTUcjNh-VINcLcZAy1FYVS9oMq8S1Ze-HA
// Confirm it rejects nonsense token e.g.
// asdofiajfoiwjefoiajefwoweijf
// Confirm it rejects valid token from non-admin user
// Confirm it can create both patients and clinicians

async function main() {
    await cleanup();
    await testCreateClinician();
    await testCreatePatient();
    await testGetAccount();
    await testUpdateAccount();
}

await main();

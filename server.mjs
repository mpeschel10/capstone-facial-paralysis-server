import { Server } from 'node:http';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

import { getNotifications } from './notifications.mjs';

if (! process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = 'secrets/facial-analytics-key.json';
}
const secrets_name = path.relative('secrets', process.env.GOOGLE_APPLICATION_CREDENTIALS);

const has_secrets_file = (await readdir('secrets')).includes(secrets_name);
if (! has_secrets_file) {
    console.log("This server requires a service account key.");
    console.log("Please follow the instructions here: https://firebase.google.com/docs/admin/setup#initialize_the_sdk_in_non-google_environments");
    console.log("In summary, go to the firebase console, Project settings > service accounts > Generate new private key");
    console.log("Then paste the file as ./secrets/facial-analytics-key.json");
    process.exit();
}

const app = initializeApp({
    credential: applicationDefault(),
});
const auth = getAuth(app);
const notifications = getNotifications(app);

const PORT = process.env.PORT ?? '17447';

function awfulReadAll(stream) {
    const chunks = [];
    return new Promise((resolve, reject) => {
        stream.on('data', data => chunks.push(data));
        stream.on('error', error => reject(error));
        stream.on('close', () => resolve(new Blob(chunks).text()));
        // Note that we are "resolving" on a Promise,
        //  but Promises unwrap Promises, so the awaiting function will get the contents of .text().
    });
}

async function tryReadBodyJson(req, res) {
    let bodyString;
    try {
        bodyString = await awfulReadAll(req);
    } catch (error) {
        res.statusCode = 500;
        res.end();
        throw error;
    }

    try {
        return JSON.parse(bodyString);
    } catch (error) {
        res.statusCode = 400;
        res.end("You must provide a parseable JSON body to this endpoint.");
        throw error;
    }
}

async function verifyIdToken(token) {
    try {
        return [ undefined, await auth.verifyIdToken(token) ];
    } catch (error) {
        return [ error, undefined ];
    }
}

async function verifyClinician(req, res) {
    const token = req.searchParams.get('token');
    if (token === null) {
        res.statusCode = 401;
        res.end("Request must have token query parameter where token = await signInWithEmailAndPassword(...).user.getIdToken()");
        return false;
    }
    
    let claims = undefined;
    try {
        claims = await auth.verifyIdToken(token);
    } catch (error) {
        res.statusCode = 401;
        res.end("Invalid token. Might be expired, or you might be uploading the wrong thing, or wrapping it in quotes, or something.");
        return false;
    }

    if (!claims.roles?.includes('c')) {
        res.statusCode = 403;
        res.end("You must be a clinician to update an account.");
        return false;
    }
    return true;
}

async function verifyLoggedIn(req, res) {
    const token = req.searchParams.get('token');
    if (token === null) {
        res.statusCode = 401;
        res.end("Request must have token query parameter where token = await signInWithEmailAndPassword(...).user.getIdToken()");
        return false;
    }
    
    try {
        return await auth.verifyIdToken(token);
    } catch (error) {
        res.statusCode = 401;
        res.end("Invalid token. Might be expired, or you might be uploading the wrong thing, or wrapping it in quotes, or something.");
        return false;
    }
}

async function ensureUid(req, res) {
    try {
        const uid = req.searchParams.get('uid');
        if (uid) return uid;
        const email = req.searchParams.get('email');
        if (email) return await auth.getUserByEmail(email).uid;

        res.statusCode = 400;
        res.end("You must provide query parameters for either uid or email.");
        return undefined;
    } catch (error) {
        res.statusCode = 400;
        res.end(error.message);
        return undefined;
    }
}

function getUser(uid, email) {
    console.log("Getting user by uid ", uid, " or email ", email);
    if (uid) return auth.getUser(uid);
    if (email) return auth.getUserByEmail(email);
    throw new Error('You must define query parameters for either uid or email.');
}

async function createUser(newUser) {
    if (newUser === undefined) return [ new Error('user must be defined.'), undefined];
    if (newUser.email === undefined) return [ new Error('user.email must be defined.'), undefined];
    if (newUser.password === undefined) return [ new Error('user.password must be defined.'), undefined];

    const validatedUser = {};
    for (const paramName of ['email', 'emailVerified', 'phoneNumber', 'password', 'displayName', 'photoURL', 'disabled' ]) {
        validatedUser[paramName] = newUser[paramName];
    }

    const customClaim = {
        roles: ['c']
    };
    if (newUser.roles) {
        if (newUser.roles.length !== 1) {
            return [ new Error('user.roles, if present, must have length exactly 1.')]
        }
        if (newUser.roles[0] !== 'c' && newUser.roles[0] !== 'p') {
            return [ new Error('user.roles, if present, must contain only \'c\' or \'p\'.')]
        }
        customClaim.roles = newUser.roles;
    }
    
    try {
        const userRecord = await auth.createUser(validatedUser);
        await auth.setCustomUserClaims(userRecord.uid, customClaim);

        return [ undefined, userRecord ];
    } catch (error) {
        return [ error, undefined ];
    }
}

async function deleteUser(uid, email) {
    try {
        if (uid === undefined) {
            if (email === undefined) {
                return [ new Error("At least one of uid and email must be defined."), undefined ];
            }
            uid = (await auth.getUserByEmail(email)).uid;
        }
        await auth.deleteUser(uid);
        return [ undefined, uid ];
    } catch (error) {
        return [ error, uid ];
    }
}

async function GET_users_json(req, res) {
    const token = req.searchParams.get('token');
    const uid = req.searchParams.get('uid');
    const email = req.searchParams.get('email');
    
    if (token === undefined) {
        res.statusCode = 401;
        res.end("Request must have token query parameter where token = await signInWithEmailAndPassword(...).user.getIdToken()");
        return;
    }
    
    const [ authError, claims ] = await verifyIdToken(token);
    if (authError) {
        res.statusCode = 401;
        res.end("Invalid token. Might be expired, or you might be uploading the wrong thing, or wrapping it in quotes, or something.");
        return;
    }

    // console.log('Requested by ', claims, ' to get account ', uid, email);
    if (!claims.roles?.includes('c')) {
        res.statusCode = 403;
        res.end("You must be a clinician to read an arbitrary account.");
        return;
    }

    try {
        const result = await getUser(uid, email);
        console.log('Got user', result);

        res.statusCode = 200;
        res.end(JSON.stringify(result));
        return;
    } catch (error) {
        res.statusCode = 400;
        res.end(error.toString());
        return;
    }
}

async function POST_users_json(req, res) {
    let bodyString;
    try {
        bodyString = await awfulReadAll(req);
    } catch (error) {
        res.statusCode = 500;
        res.end();
        return;
    }

    let token, newUser;
    try {
        const bodyJSON = JSON.parse(bodyString);
        token = bodyJSON.token;
        newUser = bodyJSON.user;
    } catch (error) {
        res.statusCode = 400;
        res.end("Body of request should be JSON object with {token: idToken, user: newUser}.");
        return;
    }

    if (token === undefined) {
        res.statusCode = 401;
        res.end("Body of request should be JSON object with {token: idToken, user: newUser}, where const idToken = signInWithEmailAndPassword(...).user.getIdToken()");
        return;
    }
    
    const [ authError, claims ] = await verifyIdToken(token);
    if (authError) {
        res.statusCode = 401;
        res.end("Invalid token. Might be expired, or you might be uploading the wrong thing, or wrapping it in quotes, or something.");
        return;
    }

    if (!claims.roles?.includes('c')) {
        res.statusCode = 403;
        res.end("You must be a clinician to create a new account.");
        return;
    }

    const [ createError, userRecord ] = await createUser(newUser);
    if (createError) {
        res.statusCode = 400;
        res.end(createError.toString());
        return;
    }
    console.log('New user', userRecord.uid);

    res.statusCode = 200;
    res.end(JSON.stringify(userRecord.uid));
}

async function PUT_users_json(req, res) {
    if (!await verifyClinician(req, res)) return;

    let bodyString;
    try {
        bodyString = await awfulReadAll(req);
    } catch (error) {
        res.statusCode = 500;
        res.end();
        return;
    }

    let bodyJson;
    try {
        bodyJson = JSON.parse(bodyString);
    } catch (error) {
        res.statusCode = 400;
        res.end("You must provide a JSON body containing the updated information for the user.");
        return;
    }

    const uid = await ensureUid(req, res);
    if (uid === undefined) return;
    
    try {
        await auth.updateUser(uid, bodyJson);
        if (bodyJson.customClaims) {
            await auth.setCustomUserClaims(uid, bodyJson.customClaims);
        }

        res.statusCode = 204;
        res.end();
        return;
    } catch (error) {
        res.statusCode = 400;
        res.end(error.toString());
        return;
    }
}

async function DELETE_users_json(req, res) {
    let bodyString;
    try {
        bodyString = await awfulReadAll(req);
    } catch (error) {
        res.statusCode = 500;
        res.end();
        return;
    }

    let token, uid, email;
    try {
        const bodyJSON = JSON.parse(bodyString);
        token = bodyJSON.token;
        uid = bodyJSON.user.uid;
        email = bodyJSON.user.email;
    } catch (error) {
        res.statusCode = 400;
        res.end("Body of request should be JSON object with user : {uid: ...} or user: {email:...}.");
        return;
    }

    if (token === undefined) {
        res.statusCode = 401;
        res.end("Body of request should be JSON object with {token: idToken, user}, where const idToken = signInWithEmailAndPassword(...).user.getIdToken()");
        return;
    }
    
    const [ authError, claims ] = await verifyIdToken(token);
    if (authError) {
        res.statusCode = 401;
        res.end("Invalid token. Might be expired, or you might be uploading the wrong thing, or wrapping it in quotes, or something.");
        return;
    }

    console.log('Requested by ', claims, ' to delete account ', uid, email);
    if (!claims.roles?.includes('c')) {
        res.statusCode = 403;
        res.end("You must be a clinician to delete an account.");
        return;
    }

    const [ deleteError, deletedUid ] = await deleteUser(uid, email);
    if (deleteError) {
        res.statusCode = 400;
        res.end(deleteError.toString());
        return;
    }
    console.log('Deleted user', deletedUid);

    res.statusCode = 204;
    res.end();
}

async function OPTIONS_users_json(req, res) {
    res.setHeader('Access-Control-Allow-Origin', req.headers.Origin ?? '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.statusCode = 204;
    res.end();
}

async function users_json(req, res) {
    switch (req.method) {
        case 'GET':
            await GET_users_json(req, res);
            break;
        case 'POST':
            await POST_users_json(req, res);
            break;
        case 'PUT':
            await PUT_users_json(req, res);
            break;
        case 'DELETE':
            await DELETE_users_json(req, res);
            break;
        case 'OPTIONS':
            await OPTIONS_users_json(req, res);
            break;
        default:
            res.statusCode = 405;
            res.end(`Method ${req.method} not supported for this endpoint.`);
            return;
    }
}

async function PUT_notifications_json(req, res) {
    const claims = await verifyLoggedIn(req, res);
    if (!claims) return;

    let pushToken;
    try {
        pushToken = await tryReadBodyJson(req, res);
    } catch (error) {
        return;
    }
    
    if (!await notifications.isValidToken(pushToken)) {
        res.statusCode = 400;
        res.end(
            'You must give this endpoint a push token in your request body.\r\n'
        );
        return;
    }

    console.log(`Registering push token ${pushToken} for uid ${claims.uid}`);
    notifications.register(pushToken, claims.uid);
    res.statusCode = 204;
    res.end();
}

async function DELETE_notifications_json(req, res) {
    const claims = await verifyLoggedIn(req, res);
    if (!claims) return;

    let pushToken;
    try {
        pushToken = await tryReadBodyJson(req, res);
    } catch (error) {
        return;
    }
    
    console.log(`Unregistering push token ${pushToken}`);
    notifications.unregister(pushToken);
    res.statusCode = 204;
    res.end();
}

async function notifications_json(req, res) {
    switch (req.method) {
        case 'PUT':
            await PUT_notifications_json(req, res);
            break;
        case 'DELETE':
            await DELETE_notifications_json(req, res);
            break;
        default:
            res.statusCode = 405;
            res.end(`Method ${req.method} not supported for this endpoint.`);
            return;
    }
}

new Server(async (req, res) => {
    try {
        let url = req.url;
        if (!url.startsWith('http://')) {
            if (url.startsWith('/')) {
                url = 'localhost' + url;
            }
            url = 'http://' + url;
        }
        url = new URL(url);
        
        const pathname = url.pathname;
        const searchParams = url.searchParams;
        req.pathname = pathname;
        req.searchParams = searchParams;
        console.log(req.method, req.pathname);
        
        res.setHeader('Access-Control-Allow-Origin', req.headers.origin ?? '*');
        switch (req.pathname) {
            case '/users.json':
                await users_json(req, res);
                break;
            case '/notifications.json':
                await notifications_json(req, res);
                break;
            default:
                res.statusCode = 404;
                res.end(`Resource ${req.url} not found.`);
                return;
        }
    } catch (error) {
        console.log("Error:", error);
        res.statusCode = 500;
        res.end();
    }
}).listen(PORT);

const db = getFirestore(auth.app);
let awfulHackyIsFirstSnapshot = true;
db.collection('messages').onSnapshot(async snapshot => {
    try {
        // Firebase does not distinguish between messages that are "new to your instance" and "new to the entire database",
        //  so when the server reboots, it is told that every single message in the database has just been "added".
        // Therefore, ignore that first round of messages.
        if (awfulHackyIsFirstSnapshot) {
            awfulHackyIsFirstSnapshot = false;
            return;
        }
        // In the long term, we should probably add a "notified"-type field to each message,
        //  so we can write a query asking for unnotified messages and therefore not crash the server on startup
        //  due to downloading 5 years worth of messages all at once.
    
        for (const docChange of snapshot.docChanges()) {
            if (docChange.type !== 'added') {
                continue;
            }
            const data = docChange.doc.data();
            console.log('Sending notification of message', data, 'to uid', data.to);
            const fromDoc = await getFirestore(auth.app).doc(`users/${data.from}`).get();
            const fromName = fromDoc.data().name;
            
            // Second argument to notifications.notify() should be as described here:
            // https://firebase.google.com/docs/reference/admin/node/firebase-admin.messaging.tokenmessage.md#tokenmessage_interface
            //  with more fields here:
            // https://firebase.google.com/docs/reference/admin/node/firebase-admin.messaging.basemessage.md#basemessage_interface
            //  except for the "token" field, which should be filled by notify() based on notifications.register/unregister.
            // Bugs will happen if you set the "token" field.
            // Also more fields documented here:
            await notifications.notify(data.to, {
                notification: {
                    // title: `Facial Analytics message from ${fromName}`,
                    body: `Facial Analytics message from ${fromName}`,
                },
                android: {
                    notification: {
                        channelId: 'default',
                        body: `Facial Analytics message from ${fromName}`,
                    }
                }
                // data: { withSome: 'data' },
            });
        }
    } catch (error) {
        console.error(error);
    }
})


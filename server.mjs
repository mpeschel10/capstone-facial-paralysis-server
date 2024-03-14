import { Server } from 'node:http';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

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

async function verifyIdToken(token) {
    try {
        return [ undefined, await auth.verifyIdToken(token) ];
    } catch (error) {
        return [undefined, error];
    }
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

    if (!claims.roles.includes('c')) {
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

    if (!claims.roles.includes('c')) {
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

async function users_json(req, res) {
    switch (req.method) {
        case 'POST':
            await POST_users_json(req, res);
            break;
        case 'DELETE':
            await DELETE_users_json(req, res);
            break;
        default:
            res.statusCode = 405;
            res.end(`Method ${req.method} not supported for this endpoint.`);
            return;
    }
}

new Server(async (req, res) => {
    try {
        console.log(req.method, req.url);
    
        switch (req.url) {
            case '/users.json':
                await users_json(req, res);
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

